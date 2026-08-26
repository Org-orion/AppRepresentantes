<#
.SYNOPSIS
    Verifica OFFLINE um conjunto de backup do Portal.

.DESCRIPTION
    Não toca rede, não toca banco, não precisa de credencial. Recalcula todos os
    hashes do manifesto, confere estrutura e valida o selo.

    É a porta de entrada do ensaio de restauração: se isto não passar, não faz
    sentido tentar restaurar.

.EXAMPLE
    .\Verify-PortalBackup.ps1 -SetPath 'C:\...\AppRepresentatives-Backups\sets\2026-08-26T020000'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string] $SetPath,

    # Verifica todos os sets sob esta raiz.
    [string] $SetsRoot,

    [switch] $LoadFunctionsOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:VERIFY_EXIT = @{
    OK             = 0
    NotFound       = 1
    NoManifest     = 2
    HashMismatch   = 3
    NoSeal         = 4
    SealInvalid    = 5
    StructureBad   = 6
}

$script:ManifestName   = 'SHA256SUMS.txt'
$script:SealName       = 'BACKUP-OK.json'
$script:EvidencePrefix = 'BACKUP-EVIDENCE'

function Get-FileSha256Local {
    param([string] $Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

<#
    Verifica um set. Devolve um objeto com Ok, ExitCode e a lista de problemas.

    Ordem deliberada: estrutura → manifesto → hashes → selo. Um manifesto
    ausente é problema diferente de um hash divergente, e o código de saída
    precisa distinguir os dois.
#>
function Test-BackupSet {
    param([string] $SetPath)

    $problems = New-Object System.Collections.Generic.List[string]
    $result = [ordered]@{
        SetPath = $SetPath; SetId = (Split-Path $SetPath -Leaf)
        Ok = $false; ExitCode = $script:VERIFY_EXIT.OK
        Reason = $null; Files = 0; Problems = @()
    }

    if (-not (Test-Path -LiteralPath $SetPath -PathType Container)) {
        $result.ExitCode = $script:VERIFY_EXIT.NotFound
        $result.Problems = @("set não encontrado: $SetPath")
        return [pscustomobject]$result
    }

    # ── estrutura mínima ──────────────────────────────────────────────────────
    #
    # Regex, não glob: `backup-portal-dados-*.sql` também casaria com o
    # `.raw.sql`, e a ausência do arquivo FINAL passaria despercebida aqui —
    # só apareceria depois, como hash faltando. O `(?<!\.raw)` separa os dois.
    $all = @(Get-ChildItem -LiteralPath $SetPath -Recurse -File)
    $result.Files = $all.Count
    $required = [ordered]@{
        'roles'        = '^backup-portal-roles-.+\.sql$'
        'schema (raw)' = '^backup-portal-schema-.+\.raw\.sql$'
        'schema'       = '^backup-portal-schema-.+(?<!\.raw)\.sql$'
        'dados (raw)'  = '^backup-portal-dados-.+\.raw\.sql$'
        'dados'        = '^backup-portal-dados-.+(?<!\.raw)\.sql$'
        'evidência'    = ('^' + $script:EvidencePrefix + '-.+\.txt$')
    }
    foreach ($k in $required.Keys) {
        if (-not ($all | Where-Object { $_.Name -match $required[$k] })) {
            $problems.Add("artefato ausente: $k")
        }
    }
    if ($problems.Count -gt 0) {
        $result.ExitCode = $script:VERIFY_EXIT.StructureBad
        # .ToArray() e nao @(): no PowerShell 5.1, @(<List[object]>) atribuido a
        # uma chave de [ordered] lanca "Os tipos de argumento nao correspondem".
        $result.Problems = $problems.ToArray(); return [pscustomobject]$result
    }

    # ── manifesto ─────────────────────────────────────────────────────────────
    $manifestPath = Join-Path $SetPath $script:ManifestName
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        $result.ExitCode = $script:VERIFY_EXIT.NoManifest
        $result.Problems = @('manifesto ausente'); return [pscustomobject]$result
    }

    $declared = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($manifestPath, [System.Text.Encoding]::UTF8)) {
        if (-not $line.Trim()) { continue }
        $m = [regex]::Match($line, '^([0-9a-f]{64})\s\s(.+)$')
        if (-not $m.Success) { $problems.Add("linha inválida no manifesto: $line"); continue }
        $declared[$m.Groups[2].Value] = $m.Groups[1].Value
    }

    # ── hashes: recalcular TUDO ───────────────────────────────────────────────
    foreach ($rel in $declared.Keys) {
        $full = Join-Path $SetPath ($rel -replace '/', '\')
        if (-not (Test-Path -LiteralPath $full)) { $problems.Add("arquivo do manifesto ausente: $rel"); continue }
        if ((Get-FileSha256Local -Path $full) -ne $declared[$rel]) { $problems.Add("hash divergente: $rel") }
    }

    # arquivo a mais dentro do set também é adulteração
    foreach ($f in $all) {
        if ($f.Name -eq $script:ManifestName -or $f.Name -eq $script:SealName) { continue }
        $rel = $f.FullName.Substring($SetPath.Length).TrimStart('\', '/') -replace '\\', '/'
        if (-not $declared.ContainsKey($rel)) { $problems.Add("arquivo fora do manifesto: $rel") }
    }

    if ($problems.Count -gt 0) {
        $result.ExitCode = $script:VERIFY_EXIT.HashMismatch
        $result.Problems = $problems.ToArray(); return [pscustomobject]$result
    }

    # ── selo ──────────────────────────────────────────────────────────────────
    $sealPath = Join-Path $SetPath $script:SealName
    if (-not (Test-Path -LiteralPath $sealPath)) {
        $result.ExitCode = $script:VERIFY_EXIT.NoSeal
        $result.Problems = @('BACKUP-OK.json ausente — conjunto NÃO é um backup válido')
        return [pscustomobject]$result
    }

    try { $seal = Get-Content -LiteralPath $sealPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch {
        $result.ExitCode = $script:VERIFY_EXIT.SealInvalid
        $result.Problems = @('BACKUP-OK.json ilegível'); return [pscustomobject]$result
    }

    foreach ($p in @('timestamp', 'setId', 'reason', 'artifacts', 'validations')) {
        if (-not ($seal.PSObject.Properties.Name -contains $p)) { $problems.Add("selo sem campo obrigatório: $p") }
    }
    if ($problems.Count -eq 0) {
        if (@($seal.artifacts).Count -ne $declared.Count) {
            $problems.Add(("selo declara {0} artefatos, manifesto tem {1}" -f @($seal.artifacts).Count, $declared.Count))
        }
        foreach ($a in @($seal.artifacts)) {
            if (-not $declared.ContainsKey($a.name)) { $problems.Add("artefato do selo fora do manifesto: $($a.name)") }
            elseif ($declared[$a.name] -ne $a.sha256) { $problems.Add("hash do selo difere do manifesto: $($a.name)") }
        }
        if ($seal.reason -notin @('scheduled', 'prechange', 'manual')) {
            $problems.Add("reason inválido no selo: $($seal.reason)")
        }
    }

    if ($problems.Count -gt 0) {
        $result.ExitCode = $script:VERIFY_EXIT.SealInvalid
        $result.Problems = $problems.ToArray(); return [pscustomobject]$result
    }

    $result.Ok = $true
    $result.Reason = $seal.reason
    $result.Problems = @()
    return [pscustomobject]$result
}

function Invoke-VerifyMain {
    param([string] $SetPath, [string] $SetsRoot)

    $targets = @()
    if ($SetPath)  { $targets += $SetPath }
    elseif ($SetsRoot) {
        $targets += @(Get-ChildItem -LiteralPath $SetsRoot -Directory | ForEach-Object { $_.FullName })
    }
    else { Write-Host 'Informe -SetPath ou -SetsRoot'; return 1 }

    $worst = 0
    foreach ($t in $targets) {
        $r = Test-BackupSet -SetPath $t
        if ($r.Ok) {
            Write-Host ("OK    {0}  ({1}, {2} arquivos)" -f $r.SetId, $r.Reason, $r.Files)
        } else {
            Write-Host ("FALHA {0}  exit={1}" -f $r.SetId, $r.ExitCode)
            foreach ($p in $r.Problems) { Write-Host ("        - {0}" -f $p) }
            if ($r.ExitCode -gt $worst) { $worst = $r.ExitCode }
        }
    }
    return $worst
}

if (-not $LoadFunctionsOnly) {
    exit (Invoke-VerifyMain -SetPath $SetPath -SetsRoot $SetsRoot)
}
