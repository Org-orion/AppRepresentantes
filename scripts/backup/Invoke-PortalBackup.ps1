<#
.SYNOPSIS
    Backup completo do banco do Portal (Supabase) — achado A9.

.DESCRIPTION
    Gera, valida e sela um conjunto de backup: roles, schema, dados, objetos de
    Storage, manifesto SHA-256 e evidência. Depois copia cifrado para fora da
    máquina e aplica retenção GFS.

    O SET SELADO É IMUTÁVEL. Nada é escrito dentro dele depois do BACKUP-OK.json.
    Resultado de cópia externa, retenção e código de saída ficam FORA do set, em
    logs\RUN-RESULT-<setId>.json.

    Não depende de Docker. Usa pg_dump/pg_dumpall/psql nativos.

.NOTES
    Senha: EXCLUSIVAMENTE de %APPDATA%\postgresql\pgpass.conf (PGPASSFILE).
    O script nunca recebe, lê ou registra a senha.
#>
[CmdletBinding()]
param(
    # scheduled = rotina diária · prechange = antes de mudança · manual = avulso
    [ValidateSet('scheduled', 'prechange', 'manual')]
    [string] $Reason = 'manual',

    # Anotação livre. Em `prechange`, descreva o que vai mudar.
    [string] $Note = '',

    [string] $ConfigPath,

    # Retenção em modo simulação: lista o que seria apagado e não apaga.
    [switch] $WhatIfRetention,

    # Carrega as funções sem executar nada. Usado pelos testes offline.
    [switch] $LoadFunctionsOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Task Scheduler não herda diretório corrente. Tudo resolve a partir do script.
$script:ScriptRoot = $PSScriptRoot

# ═══════════════════════════════════════════════════════════════════════════════
# CÓDIGOS DE SAÍDA
# ═══════════════════════════════════════════════════════════════════════════════
$script:EXIT = @{
    OK                 = 0
    ToolMissing        = 10
    DestinationBad     = 11
    PgpassBad          = 12
    NoConnectivity     = 13
    RolesFailed        = 20
    SchemaFailed       = 21
    DataFailed         = 22
    StorageDownload    = 30
    StorageMismatch    = 31
    StorageUnknownBkt  = 32
    StorageNotPublic   = 33
    StorageUnsafeName  = 34
    SanitySchema       = 40
    SanityCopy         = 41
    SanityAuthUsers    = 42
    SanityInternalLeak = 43
    SealFailed         = 50
    ExternalCopy       = 60
    Retention          = 70
    ConfigBad          = 80
}

# ═══════════════════════════════════════════════════════════════════════════════
# UTF-8 SEM BOM
#
# `Out-File -Encoding utf8` do PowerShell 5.1 grava BOM, e BOM no início de um
# .sql quebra o psql. Toda escrita de arquivo passa por aqui.
# ═══════════════════════════════════════════════════════════════════════════════
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-TextFileUtf8NoBom {
    param([string] $Path, [string] $Content)
    [System.IO.File]::WriteAllText($Path, $Content, $script:Utf8NoBom)
}

function New-StreamWriterUtf8NoBom {
    param([string] $Path)
    return (New-Object System.IO.StreamWriter($Path, $false, $script:Utf8NoBom))
}

# ═══════════════════════════════════════════════════════════════════════════════
# LOG — nunca senha, DB_URL, token, service key ou conteúdo de dump
# ═══════════════════════════════════════════════════════════════════════════════
$script:LogPath = $null

function Write-Log {
    param(
        [string] $Message,
        [ValidateSet('INFO', 'WARN', 'ERRO', 'OK')] [string] $Level = 'INFO'
    )
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffzzz'), $Level, $Message
    Write-Host $line
    if ($script:LogPath) {
        [System.IO.File]::AppendAllText($script:LogPath, $line + [Environment]::NewLine, $script:Utf8NoBom)
    }
}

class BackupStageError : System.Exception {
    [int] $Code
    BackupStageError([string] $message, [int] $code) : base($message) { $this.Code = $code }
}

function Stop-Stage {
    param([string] $Message, [int] $Code)
    throw [BackupStageError]::new($Message, $Code)
}

# ═══════════════════════════════════════════════════════════════════════════════
# EXECUÇÃO DE PROCESSO NATIVO
#
# PowerShell 5.1 NÃO transforma exit != 0 de executável nativo em erro
# terminante, e `$ErrorActionPreference` não muda isso. Pior: redirecionar
# stderr de um nativo (`2>` ou `2>&1`) faz o 5.1 embrulhar cada linha num
# ErrorRecord (NativeCommandError) — com `$ErrorActionPreference = 'Stop'` isso
# derruba a execução mesmo quando o processo terminou com 0. Um pg_dump que
# emite um único aviso mataria um backup perfeitamente bom.
#
# Por isso NADA aqui usa o operador `&` com redirecionamento nem depende de
# `$LASTEXITCODE`. Tudo passa por System.Diagnostics.Process, onde o exit code
# é lido do próprio processo e stdout/stderr são capturados sem virar erro.
# ═══════════════════════════════════════════════════════════════════════════════

<#
    Monta a linha de comando no formato que CommandLineToArgvW desfaz.

    .NET Framework 4.x (o runtime do PowerShell 5.1) não tem
    ProcessStartInfo.ArgumentList — só a string `Arguments`. Montar essa string
    à mão é obrigatório, e o escaping segue a regra do MSVCRT: barras invertidas
    imediatamente antes de aspas dobram; aspas viram \"; barras no fim dobram.
#>
function ConvertTo-NativeArgumentString {
    param([string[]] $Arguments)

    if (-not $Arguments -or $Arguments.Count -eq 0) { return '' }
    $q = [char]34   # aspas
    $b = [char]92   # barra invertida
    $out = New-Object System.Collections.Generic.List[string]

    foreach ($a in $Arguments) {
        $s = [string]$a
        if ($s.Length -gt 0 -and $s -notmatch '[\s"]') { $out.Add($s); continue }

        $sb = New-Object System.Text.StringBuilder
        [void]$sb.Append($q)
        $slashes = 0
        foreach ($ch in $s.ToCharArray()) {
            if ($ch -eq $b) { $slashes++; continue }
            if ($ch -eq $q) {
                [void]$sb.Append([string]$b * ($slashes * 2 + 1)); [void]$sb.Append($q); $slashes = 0; continue
            }
            if ($slashes -gt 0) { [void]$sb.Append([string]$b * $slashes); $slashes = 0 }
            [void]$sb.Append($ch)
        }
        if ($slashes -gt 0) { [void]$sb.Append([string]$b * ($slashes * 2)) }
        [void]$sb.Append($q)
        $out.Add($sb.ToString())
    }
    return ($out -join ' ')
}

<#
    Executa um processo nativo e devolve ExitCode, StdOut e StdErr.

    NUNCA lança por causa do exit code — quem decide é o chamador. Isso é
    proposital: torna o wrapper testável com um processo que retorna 0 e outro
    que retorna != 0, sem depender de preferência global nenhuma.

    WorkingDirectory é fixado no diretório do script: o Task Scheduler não herda
    o diretório corrente da sessão.
#>
function Invoke-NativeCommand {
    param([string] $Exe, [string[]] $Arguments)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = $Exe
    $psi.Arguments              = ConvertTo-NativeArgumentString $Arguments
    $psi.UseShellExecute        = $false
    $psi.CreateNoWindow         = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding  = [System.Text.Encoding]::UTF8
    if ($script:ScriptRoot -and (Test-Path -LiteralPath $script:ScriptRoot)) {
        $psi.WorkingDirectory = $script:ScriptRoot
    }

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    try {
        [void]$p.Start()
        # Leitura assíncrona dos dois canais: ler um até o fim antes do outro
        # trava quando o buffer do que ficou parado enche.
        $outTask = $p.StandardOutput.ReadToEndAsync()
        $errTask = $p.StandardError.ReadToEndAsync()
        $p.WaitForExit()
        return [pscustomobject]@{
            Exe      = $Exe
            ExitCode = $p.ExitCode
            StdOut   = $outTask.Result
            StdErr   = $errTask.Result
        }
    }
    finally { $p.Dispose() }
}

# Últimas linhas do stderr, para a mensagem de falha. Sem conteúdo de dump.
function Get-StdErrTail {
    param([string] $Text, [int] $Lines = 5)
    if (-not $Text) { return '(sem stderr)' }
    return ((($Text -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -Last $Lines) -join ' | ')
}

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO E FERRAMENTAS
# ═══════════════════════════════════════════════════════════════════════════════
<#
    Carrega, NORMALIZA e valida a configuração.

    `-ConfigPath` relativo resolve contra o DIRETÓRIO DO SCRIPT, nunca contra o
    diretório corrente: o Task Scheduler não herda CWD, e resolver contra ele
    faria a tarefa agendada ler outro arquivo — ou nenhum.
#>
function Import-BackupConfig {
    param([string] $Path)

    if (-not $Path) { $Path = Join-Path $script:ScriptRoot 'backup.config.psd1' }
    elseif (-not [System.IO.Path]::IsPathRooted($Path)) {
        $Path = Join-Path $script:ScriptRoot $Path
    }
    if (-not (Test-Path -LiteralPath $Path)) {
        Stop-Stage "Configuração não encontrada: $Path — copie backup.config.sample.psd1" $script:EXIT.ConfigBad
    }
    $cfg = Import-PowerShellDataFile -LiteralPath $Path
    $cfg = Resolve-BackupConfig -Cfg $cfg
    Assert-ConfigPathsAbsolute -Cfg $cfg
    return $cfg
}

<#
    Normaliza a configuração antes de qualquer uso.

    Sob `Set-StrictMode -Version Latest`, ler uma chave que não existe numa
    hashtable com notação de ponto LANÇA. Uma config copiada de um sample antigo
    morreria com "a propriedade X não foi encontrada" no meio da execução, em vez
    de uma mensagem que diz o que fazer.

    Aqui as obrigatórias faltando viram erro claro (exit 80) e as opcionais
    ganham default. Depois disto, todo `$cfg.X` do resto do script é seguro.
#>
function Resolve-BackupConfig {
    param([hashtable] $Cfg)

    $obrigatorias = @{
        'Db'                   = @('Host', 'Port', 'Database', 'User', 'Role')
        'Baseline'             = @('SchemaPublicTables', 'CopyPublic', 'CopyTotal')
        'Retention'            = @('Daily', 'Weeks', 'Months', 'PrechangeDays', 'StagingKeep')
        'SupabaseUrl'          = $null
        'BackupRoot'           = $null
        'StorageBuckets'       = $null
        'RequiredPublicTables' = $null
    }
    foreach ($k in $obrigatorias.Keys) {
        if (-not $Cfg.ContainsKey($k)) {
            Stop-Stage ("configuração: chave obrigatória ausente: {0} — compare com backup.config.sample.psd1" -f $k) $script:EXIT.ConfigBad
        }
        $sub = $obrigatorias[$k]
        if ($null -eq $sub) { continue }
        if ($Cfg[$k] -isnot [hashtable]) {
            Stop-Stage ("configuração: {0} precisa ser uma tabela @{{ ... }}" -f $k) $script:EXIT.ConfigBad
        }
        foreach ($sk in $sub) {
            if (-not $Cfg[$k].ContainsKey($sk)) {
                Stop-Stage ("configuração: chave obrigatória ausente: {0}.{1}" -f $k, $sk) $script:EXIT.ConfigBad
            }
        }
    }

    foreach ($k in @('ExternalBackupRoot', 'GpgPassphraseFile', 'PgpassFile')) {
        if (-not $Cfg.ContainsKey($k)) { $Cfg[$k] = '' }
    }
    if (-not $Cfg.ContainsKey('Tools') -or $Cfg['Tools'] -isnot [hashtable]) { $Cfg['Tools'] = @{} }
    foreach ($k in @('PgDump', 'PgDumpall', 'Psql', 'Curl', 'Tar', 'Gpg')) {
        if (-not $Cfg.Tools.ContainsKey($k)) { $Cfg.Tools[$k] = '' }
    }
    return $Cfg
}

<#
    Todo caminho operacional precisa ser ABSOLUTO.

    Um `BackupRoot` relativo gravaria o backup onde quer que o processo tenha
    começado — na sessão interativa, no diretório do script; sob o Task
    Scheduler, em `C:\Windows\System32`. Falhar aqui é melhor do que descobrir
    depois que os backups foram para outro lugar.
#>
function Assert-ConfigPathsAbsolute {
    param([hashtable] $Cfg)

    if (-not $Cfg.ContainsKey('BackupRoot') -or -not $Cfg['BackupRoot']) {
        Stop-Stage 'configuração: BackupRoot é obrigatório' $script:EXIT.ConfigBad
    }
    foreach ($k in @('BackupRoot', 'ExternalBackupRoot', 'GpgPassphraseFile', 'PgpassFile')) {
        if (-not $Cfg.ContainsKey($k)) { continue }
        $v = $Cfg[$k]
        if (-not $v) { continue }
        if (-not [System.IO.Path]::IsPathRooted($v)) {
            Stop-Stage ("configuração: {0} precisa ser caminho absoluto (recebido: '{1}')" -f $k, $v) $script:EXIT.ConfigBad
        }
    }
    if (-not $Cfg.ContainsKey('Tools') -or $Cfg['Tools'] -isnot [hashtable]) { return }
    foreach ($k in @('PgDump', 'PgDumpall', 'Psql', 'Curl', 'Tar', 'Gpg')) {
        if (-not $Cfg.Tools.ContainsKey($k)) { continue }
        $v = $Cfg.Tools[$k]
        if (-not $v) { continue }
        if (-not [System.IO.Path]::IsPathRooted($v)) {
            Stop-Stage ("configuração: Tools.{0} precisa ser caminho absoluto (recebido: '{1}')" -f $k, $v) $script:EXIT.ConfigBad
        }
    }
}

<#
    Resolve o caminho ABSOLUTO de cada ferramenta.

    Task Scheduler não herda o PATH da sessão interativa. Se a config traz o
    caminho, ele manda; senão resolvemos uma vez via Get-Command e registramos o
    caminho resolvido — para o log dizer exatamente qual binário rodou.
#>
function Resolve-Tool {
    param([string] $Configured, [string] $CommandName)

    if ($Configured) {
        if (-not (Test-Path -LiteralPath $Configured)) {
            Stop-Stage "Ferramenta configurada não existe: $Configured" $script:EXIT.ToolMissing
        }
        return (Resolve-Path -LiteralPath $Configured).ProviderPath
    }
    $cmd = Get-Command $CommandName -CommandType Application -ErrorAction SilentlyContinue |
           Select-Object -First 1
    if (-not $cmd) {
        Stop-Stage "Ferramenta não encontrada: $CommandName — informe o caminho absoluto em Tools" $script:EXIT.ToolMissing
    }
    return $cmd.Source
}

function Get-ToolVersion {
    param([string] $Exe)
    # Sem `2>&1`: várias ferramentas imprimem a versão no stderr, e o 5.1
    # transformaria isso em NativeCommandError sob $ErrorActionPreference='Stop'.
    try {
        $r = Invoke-NativeCommand -Exe $Exe -Arguments @('--version')
        $t = if ($r.StdOut.Trim()) { $r.StdOut } else { $r.StdErr }
        $first = @($t -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -First 1
        if ($first) { return $first.Trim() }
        return 'desconhecida'
    }
    catch { return 'desconhecida' }
}

# ═══════════════════════════════════════════════════════════════════════════════
# CREDENCIAL — .pgpass é a ÚNICA fonte da senha
# ═══════════════════════════════════════════════════════════════════════════════

<#
    Principals aceitáveis numa ACE Allow de um arquivo de segredo
    (`pgpass.conf` e o arquivo de passphrase do GPG).

    Whitelist, não blacklist: qualquer Allow fora desta lista derruba a
    execução. Procurar só por "Everyone"/"Users" deixaria passar um grupo
    qualquer que tivesse recebido acesso.

    São DOIS, e só dois:

      • o usuário atual — quem roda o backup precisa ler o arquivo;
      • `NT AUTHORITY\SYSTEM` — necessidade operacional documentada: uma tarefa
        do Task Scheduler configurada com "Run whether user is logged on or not"
        pode rodar como SYSTEM. Sem essa ACE a rotina agendada não leria o
        arquivo, e a alternativa seria afrouxar a ACL inteira.

    `BUILTIN\Administrators` NÃO está na lista, de propósito. Não há necessidade
    operacional para ela: nem o backup interativo nem o agendado rodam sob esse
    grupo. Um administrador local continua podendo tomar posse do arquivo — o
    ponto não é impedir isso, é que a ACE larga não exista por inércia de
    herança sem ninguém perceber. O `icacls` do README remove a herança e deixa
    exatamente o usuário atual.
#>
function Get-AllowedSecretFilePrincipals {
    $sids = @(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value  # usuário atual
        'S-1-5-18'                                                            # NT AUTHORITY\SYSTEM
    )
    return $sids
}

<#
    Valida um arquivo de segredo sem NUNCA ler o conteúdo.

    O que se verifica é existência e ACL. A senha/passphrase não é lida, não é
    comparada e não entra em variável nenhuma — quem a lê é o libpq ou o gpg.
#>
function Test-SecretFileSecurity {
    param([string] $Path)

    $result = [ordered]@{ Path = $Path; Exists = $false; AclOk = $false; Offenders = @() }

    if (-not (Test-Path -LiteralPath $Path)) { return $result }
    $result.Exists = $true

    $allowed = Get-AllowedSecretFilePrincipals
    $acl = Get-Acl -LiteralPath $Path
    $offenders = @()

    foreach ($ace in $acl.Access) {
        if ($ace.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
        try {
            $sid = ($ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier])).Value
        } catch {
            $offenders += ('não-resolvível: ' + $ace.IdentityReference.Value); continue
        }
        if ($allowed -notcontains $sid) { $offenders += $ace.IdentityReference.Value }
    }

    $result.Offenders = $offenders
    $result.AclOk = ($offenders.Count -eq 0)
    return $result
}

<#
    Exige que um arquivo de segredo exista e tenha ACL restrita, ou aborta.
    Usado igualmente pelo pgpass e pela passphrase do GPG — a disciplina é a
    mesma; documentar não basta, tem que ser verificado.
#>
function Assert-SecretFile {
    param([string] $Path, [string] $Rotulo, [int] $FailCode)

    $sec = Test-SecretFileSecurity -Path $Path
    if (-not $sec.Exists) {
        Stop-Stage ("{0} ausente: {1}" -f $Rotulo, $Path) $FailCode
    }
    if (-not $sec.AclOk) {
        Stop-Stage ("ACL de {0} concede acesso a principal inesperado: {1}" -f $Rotulo, ($sec.Offenders -join ', ')) $FailCode
    }
    Write-Log ("{0}: presente, ACL restrita" -f $Rotulo) 'OK'
}

<#
    Ambiente de conexão do libpq.

    PGPASSWORD herdado do processo chamador tem precedência sobre o .pgpass e
    silenciosamente trocaria a fonte da senha — por isso é NEUTRALIZADO.
    As variáveis originais são devolvidas para o chamador restaurar depois.
#>
function Set-LibpqEnvironment {
    param([string] $PgpassFile)

    $saved = @{}
    foreach ($n in @('PGPASSWORD', 'PGPASSFILE', 'PGSSLMODE', 'PGHOST', 'PGPORT',
                     'PGUSER', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE')) {
        $saved[$n] = [Environment]::GetEnvironmentVariable($n, 'Process')
    }

    $env:PGPASSWORD = $null            # neutraliza herança
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:PGSERVICE -ErrorAction SilentlyContinue
    Remove-Item Env:PGSERVICEFILE -ErrorAction SilentlyContinue
    Remove-Item Env:PGHOST -ErrorAction SilentlyContinue
    Remove-Item Env:PGPORT -ErrorAction SilentlyContinue
    Remove-Item Env:PGUSER -ErrorAction SilentlyContinue
    Remove-Item Env:PGDATABASE -ErrorAction SilentlyContinue

    $env:PGPASSFILE = $PgpassFile      # fonte única e explícita
    $env:PGSSLMODE  = 'require'        # o pooler exige TLS

    return $saved
}

function Restore-LibpqEnvironment {
    param([hashtable] $Saved)
    foreach ($n in $Saved.Keys) {
        if ($null -eq $Saved[$n]) { Remove-Item ("Env:" + $n) -ErrorAction SilentlyContinue }
        else { Set-Item ("Env:" + $n) $Saved[$n] }
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# ESTÁGIOS — todo nativo passa por Invoke-NativeCommand e falha por exit code
# ═══════════════════════════════════════════════════════════════════════════════

<#
    Roda a ferramenta de um estágio e ABORTA no primeiro exit != 0, mapeando
    para o código do estágio. Nenhum arquivo parcial segue adiante: quem chama
    só continua se esta função retornar.
#>
function Invoke-Tool {
    param(
        [string]   $Exe,
        [string[]] $Arguments,
        [string]   $Stage,
        [int]      $FailCode
    )
    Write-Log ("{0}: {1}" -f $Stage, [System.IO.Path]::GetFileName($Exe))
    $r = Invoke-NativeCommand -Exe $Exe -Arguments $Arguments
    if ($r.ExitCode -ne 0) {
        Stop-Stage ("{0} falhou (código {1}): {2}" -f $Stage, $r.ExitCode, (Get-StdErrTail $r.StdErr)) $FailCode
    }
    return $r
}

function Invoke-PsqlScalarQuery {
    param([string] $Psql, [hashtable] $Db, [string] $Query, [int] $FailCode)
    # $psqlArgs, e nao $args: $args e variavel automatica do PowerShell.
    $psqlArgs = @(
        '--host', $Db.Host, '--port', $Db.Port, '--username', $Db.User, '--dbname', $Db.Database,
        '--no-password', '--tuples-only', '--no-align', '--field-separator', "`t",
        '--quiet', '--command', $Query
    )
    $r = Invoke-NativeCommand -Exe $Psql -Arguments $psqlArgs
    if ($r.ExitCode -ne 0) {
        Stop-Stage ("psql falhou (código {0}): {1}" -f $r.ExitCode, (Get-StdErrTail $r.StdErr)) $FailCode
    }
    # StdOut e StdErr ficam SEPARADOS: stderr nunca contamina o resultado parseado.
    return @($r.StdOut -split "`r?`n" | Where-Object { $_ -ne '' })
}

# ═══════════════════════════════════════════════════════════════════════════════
# TRANSFORMAÇÕES DO SCHEMA — as 12, na ordem do dry-run do Supabase CLI
#
# Reproduzidas em .NET/PowerShell. Nada de sed, nada de Git Bash.
# ═══════════════════════════════════════════════════════════════════════════════

# Schemas internos gerenciados. `*` vira `\w*` no regex.
$script:InternalSchemas = @(
    'information_schema', 'pg_*', '_analytics', '_realtime', '_supavisor', 'auth', 'etl',
    'extensions', 'pgbouncer', 'realtime', 'storage', 'supabase_functions',
    'supabase_migrations', 'cron', 'dbdev', 'graphql', 'graphql_public', 'net', 'pgmq',
    'pgsodium', 'pgsodium_masks', 'pgtle', 'repack', 'tiger', 'tiger_data',
    'timescaledb_*', '_timescaledb_*', 'topology', 'vault'
)

function Get-InternalSchemaRegexAlternation {
    $parts = foreach ($s in $script:InternalSchemas) {
        if ($s.EndsWith('*')) { [regex]::Escape($s.Substring(0, $s.Length - 1)) + '\w*' }
        else { [regex]::Escape($s) }
    }
    # mais longos primeiro: evita `pg_*` engolir alternativas mais específicas
    return (($parts | Sort-Object -Property Length -Descending) -join '|')
}

# Linhas comentadas no passo 8.
$script:CommentPatterns8 = @(
    '^CREATE PUBLICATION "supabase_realtime'
    '^CREATE EVENT TRIGGER'
    '^         WHEN TAG IN'
    '^   EXECUTE FUNCTION'
    '^ALTER EVENT TRIGGER'
    '^ALTER PUBLICATION "supabase_realtime_'
    '^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO'
    '^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"'
    '^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION'
)

# Linhas comentadas no passo 11.
$script:CommentPatterns11 = @(
    '^COMMENT ON EXTENSION'
    '^CREATE POLICY "cron_job_'
    '^ALTER TABLE "cron"'
    '^SET transaction_timeout = 0;'
)

<#
    Aplica as 12 transformações a UMA linha.

    Devolve $null quando a linha deve desaparecer (passo 12). Os passos 1, 8, 9 e
    11 comentam; o 12 apaga o que ficou comentado — inclusive os cabeçalhos que o
    próprio pg_dump escreve.

    ⚠️ CONSEQUÊNCIA CONHECIDA E DELIBERADA: o passo 12 apaga QUALQUER linha
    iniciada por `--`, inclusive comentários dentro de corpos de função. As
    funções restauram sintaticamente válidas, mas sem seus comentários internos.
    É o comportamento do pipeline original do Supabase CLI, reproduzido de
    propósito. O `.raw.sql` preservado é a única cópia com o código-fonte
    íntegro — por isso ele nunca deve ser apagado.
#>
function Convert-SchemaLine {
    param([string] $Line, [string] $InternalAlternation)

    $l = $Line

    # 1 — \restrict / \unrestrict
    if ($l -match '^\\(un)?restrict .*$') { return $null }   # comenta e o passo 12 apaga

    # 2..7 — idempotência
    $l = $l -replace '^CREATE SCHEMA "',   'CREATE SCHEMA IF NOT EXISTS "'
    $l = $l -replace '^CREATE TABLE "',    'CREATE TABLE IF NOT EXISTS "'
    $l = $l -replace '^CREATE SEQUENCE "', 'CREATE SEQUENCE IF NOT EXISTS "'
    $l = $l -replace '^CREATE VIEW "',     'CREATE OR REPLACE VIEW "'
    $l = $l -replace '^CREATE FUNCTION "', 'CREATE OR REPLACE FUNCTION "'
    $l = $l -replace '^CREATE TRIGGER "',  'CREATE OR REPLACE TRIGGER "'

    # 8 — objetos gerenciados pela plataforma
    foreach ($p in $script:CommentPatterns8) { if ($l -match $p) { return $null } }

    # 9 — GRANT/REVOKE dirigidos a schema interno
    if ($l -match ('^(GRANT|REVOKE)\b.*\b(' + $InternalAlternation + ')\b')) { return $null }

    # 10 — extensões com opções → forma curta
    $l = $l -replace '^CREATE EXTENSION IF NOT EXISTS "(pg_tle|pgsodium|pgmq)".*$',
                     'CREATE EXTENSION IF NOT EXISTS "$1";'

    # 11 — extensões/cron
    foreach ($p in $script:CommentPatterns11) { if ($l -match $p) { return $null } }

    # 12 — remove o que restou começando com --
    if ($l -match '^--') { return $null }

    return $l
}

function Convert-SchemaDump {
    param([string] $RawPath, [string] $OutPath)

    $alt = Get-InternalSchemaRegexAlternation
    $reader = New-Object System.IO.StreamReader($RawPath, [System.Text.Encoding]::UTF8)
    $writer = New-StreamWriterUtf8NoBom $OutPath
    try {
        while ($null -ne ($line = $reader.ReadLine())) {
            $out = Convert-SchemaLine -Line $line -InternalAlternation $alt
            if ($null -ne $out) { $writer.WriteLine($out) }
        }
    } finally {
        $reader.Dispose(); $writer.Dispose()
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# TRANSFORMAÇÃO DOS DADOS
# ═══════════════════════════════════════════════════════════════════════════════
function Convert-DataDump {
    param([string] $RawPath, [string] $OutPath)

    $reader = New-Object System.IO.StreamReader($RawPath, [System.Text.Encoding]::UTF8)
    $writer = New-StreamWriterUtf8NoBom $OutPath
    try {
        # Desliga triggers e FKs durante a carga.
        $writer.WriteLine('SET session_replication_role = replica;')
        while ($null -ne ($line = $reader.ReadLine())) {
            if ($line -match '^\\(un)?restrict\b') { $writer.WriteLine('-- ' + $line) }
            else { $writer.WriteLine($line) }
        }
        $writer.WriteLine('RESET ALL;')
    } finally {
        $reader.Dispose(); $writer.Dispose()
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# STORAGE
# ═══════════════════════════════════════════════════════════════════════════════

<#
    URL do objeto público.

    Cada SEGMENTO do nome é codificado separadamente, e as barras entre eles são
    preservadas — codificar o nome inteiro transformaria `/` em `%2F` e o
    endpoint devolveria 404. Cobre espaço, `#`, `%`, acento e Unicode.
#>
function Get-PublicObjectUrl {
    param([string] $SupabaseUrl, [string] $Bucket, [string] $ObjectName)

    $segments = $ObjectName -split '/'
    $encoded = ($segments | ForEach-Object { [System.Uri]::EscapeDataString($_) }) -join '/'
    return ('{0}/storage/v1/object/public/{1}/{2}' -f $SupabaseUrl.TrimEnd('/'),
            [System.Uri]::EscapeDataString($Bucket), $encoded)
}

<#
    Nomes reservados do Windows — reservados COM ou SEM extensão: `CON`, `CON.txt`
    e `NUL.dat` são todos impossíveis de criar.
#>
$script:WindowsReservedNames = '^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)'

<#
    Valida UM segmento de nome de objeto como nome de arquivo do Windows.
    Devolve $null quando é seguro, ou o motivo da recusa.

    Nada aqui "conserta" o nome. Renomear em silêncio produziria um backup que
    restaura com nome diferente do original — pior do que falhar.
#>
function Test-SafePathSegment {
    param([string] $Segment)

    if ($Segment -eq '')                        { return 'segmento vazio' }
    if ($Segment -eq '.' -or $Segment -eq '..') { return 'segmento de travessia (. ou ..)' }
    if ($Segment -match '[<>:"/\\|?*]')       { return 'caractere proibido no Windows' }
    if ($Segment -match '[\x00-\x1F]')          { return 'caractere de controle' }
    if ($Segment -match $script:WindowsReservedNames) { return 'nome reservado do Windows' }
    if ($Segment.EndsWith(' ') -or $Segment.EndsWith('.')) { return 'termina em espaço ou ponto' }
    return $null
}

<#
    Caminho local do objeto, preservando a estrutura original — e SOMENTE se ela
    for representável e não escapar do diretório do bucket.

    O nome do objeto vem do banco: é dado, não é confiável. `../../x`, `C:\x`,
    `\srv\share` e `CON` precisam falhar FECHADO — um backup que grava fora do
    set não é um backup válido. Depois de montado, o caminho é canonicalizado
    com GetFullPath e reconferido contra a raiz do bucket.
#>
function Get-LocalObjectPath {
    param([string] $BucketDir, [string] $ObjectName, [int] $FailCode = 34)

    $reject = {
        param($motivo)
        Stop-Stage ("nome de objeto inseguro para o filesystem: '{0}' — {1}" -f $ObjectName, $motivo) $FailCode
    }

    if ([string]::IsNullOrWhiteSpace($ObjectName)) { & $reject 'nome vazio' }
    if ($ObjectName -match '\\')               { & $reject 'contém barra invertida' }
    if ($ObjectName -match '^[A-Za-z]:')           { & $reject 'prefixo de unidade' }
    if ($ObjectName.StartsWith('/'))               { & $reject 'caminho absoluto' }

    # Validação por segmento ANTES de IsPathRooted: no .NET Framework,
    # IsPathRooted LANÇA ArgumentException diante de `<`, `>`, `"` ou `|`, e a
    # exceção crua escaparia sem virar o exit code do estágio.
    $segments = $ObjectName -split '/'
    foreach ($seg in $segments) {
        $motivo = Test-SafePathSegment -Segment $seg
        if ($motivo) { & $reject $motivo }
    }

    # Cinto: qualquer surpresa de IsPathRooted vira recusa, nunca exceção crua.
    try { $rooted = [System.IO.Path]::IsPathRooted($ObjectName) }
    catch { & $reject 'caminho inválido para o filesystem' ; $rooted = $true }
    if ($rooted) { & $reject 'caminho enraizado' }

    $candidate = $BucketDir
    foreach ($seg in $segments) { $candidate = Join-Path $candidate $seg }

    # Canonicalização + reconferência: cinto e suspensório sobre a validação acima.
    $full = [System.IO.Path]::GetFullPath($candidate)
    $root = [System.IO.Path]::GetFullPath($BucketDir).TrimEnd('\') + '\'
    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        & $reject 'resolve para fora do diretório do bucket'
    }
    return $full
}

# ═══════════════════════════════════════════════════════════════════════════════
# SANIDADE
# ═══════════════════════════════════════════════════════════════════════════════
function Get-SchemaSanity {
    param([string] $SchemaSqlPath, [string[]] $RequiredTables)

    $text = [System.IO.File]::ReadAllText($SchemaSqlPath, [System.Text.Encoding]::UTF8)

    $found = @{}
    foreach ($t in $RequiredTables) {
        $pattern = 'CREATE TABLE IF NOT EXISTS "public"\."' + [regex]::Escape($t) + '"'
        $found[$t] = [bool]([regex]::IsMatch($text, $pattern))
    }
    $total = ([regex]::Matches($text, 'CREATE TABLE IF NOT EXISTS "public"\."')).Count

    # Vazamento de schema gerenciado: o --exclude-schema usa alternação `|`. Se o
    # pg_dump interpretar esse padrão de outro jeito, ele não excluiria NADA — e o
    # dump viria com auth/storage/realtime dentro, sem erro nenhum. Guarda barata.
    $leaks = @()
    foreach ($s in @('auth', 'storage', 'realtime', 'vault', 'extensions', 'cron')) {
        if ([regex]::IsMatch($text, 'CREATE SCHEMA IF NOT EXISTS "' + $s + '"')) { $leaks += $s }
    }

    return [ordered]@{
        RequiredTables = $found
        MissingTables  = @($found.Keys | Where-Object { -not $found[$_] } | Sort-Object)
        TotalPublic    = $total
        InternalLeaks  = $leaks
    }
}

function Get-DataSanity {
    param([string] $DataSqlPath, [string[]] $RequiredTables)

    $copyPublic = @{}
    foreach ($t in $RequiredTables) { $copyPublic[$t] = $false }
    $copyTotal = 0
    $copyPublicCount = 0
    $authUsers = $false

    $reader = New-Object System.IO.StreamReader($DataSqlPath, [System.Text.Encoding]::UTF8)
    try {
        while ($null -ne ($line = $reader.ReadLine())) {
            if ($line -notmatch '^COPY ') { continue }
            $copyTotal++
            if ($line -match '^COPY "auth"\."users"') { $authUsers = $true }
            if ($line -match '^COPY "public"\."([^"]+)"') {
                $copyPublicCount++
                $name = $Matches[1]
                if ($copyPublic.ContainsKey($name)) { $copyPublic[$name] = $true }
            }
        }
    } finally { $reader.Dispose() }

    return [ordered]@{
        CopyTotal        = $copyTotal
        CopyPublic       = $copyPublicCount
        AuthUsersPresent = $authUsers
        RequiredCopy     = $copyPublic
        MissingCopy      = @($copyPublic.Keys | Where-Object { -not $copyPublic[$_] } | Sort-Object)
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# MANIFESTO / SELO
#
# Sem circularidade: SHA256SUMS cobre os artefatos e o BACKUP-EVIDENCE, mas NÃO
# a si próprio nem o BACKUP-OK.json.
# ═══════════════════════════════════════════════════════════════════════════════
$script:ManifestName = 'SHA256SUMS.txt'
$script:SealName     = 'BACKUP-OK.json'
$script:EvidencePrefix = 'BACKUP-EVIDENCE'

function Get-FileSha256 {
    param([string] $Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ManifestCandidates {
    param([string] $SetDir)
    return @(
        Get-ChildItem -LiteralPath $SetDir -Recurse -File |
        Where-Object { $_.Name -ne $script:ManifestName -and $_.Name -ne $script:SealName } |
        Sort-Object FullName
    )
}

function New-Manifest {
    param([string] $SetDir)
    $lines = New-Object System.Collections.Generic.List[string]
    $entries = New-Object System.Collections.Generic.List[object]
    foreach ($f in (Get-ManifestCandidates -SetDir $SetDir)) {
        $rel = $f.FullName.Substring($SetDir.Length).TrimStart('\', '/') -replace '\\', '/'
        $hash = Get-FileSha256 -Path $f.FullName
        $lines.Add(('{0}  {1}' -f $hash, $rel))
        $entries.Add([ordered]@{ name = $rel; bytes = $f.Length; sha256 = $hash })
    }
    Write-TextFileUtf8NoBom (Join-Path $SetDir $script:ManifestName) (($lines -join "`n") + "`n")
    # .ToArray() e nao @(): no PowerShell 5.1, @(<List[object]>) dentro de um
    # [ordered]@{} lanca "Os tipos de argumento nao correspondem".
    return $entries.ToArray()
}

function Test-Manifest {
    param([string] $SetDir)

    $manifest = Join-Path $SetDir $script:ManifestName
    $problems = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $manifest)) {
        $problems.Add('manifesto ausente'); return $problems
    }

    $declared = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($manifest, [System.Text.Encoding]::UTF8)) {
        if (-not $line.Trim()) { continue }
        $m = [regex]::Match($line, '^([0-9a-f]{64})\s\s(.+)$')
        if (-not $m.Success) { $problems.Add("linha inválida no manifesto: $line"); continue }
        $declared[$m.Groups[2].Value] = $m.Groups[1].Value
    }

    foreach ($rel in $declared.Keys) {
        $full = Join-Path $SetDir ($rel -replace '/', '\')
        if (-not (Test-Path -LiteralPath $full)) { $problems.Add("arquivo do manifesto ausente: $rel"); continue }
        if ((Get-FileSha256 -Path $full) -ne $declared[$rel]) { $problems.Add("hash divergente: $rel") }
    }

    foreach ($f in (Get-ManifestCandidates -SetDir $SetDir)) {
        $rel = $f.FullName.Substring($SetDir.Length).TrimStart('\', '/') -replace '\\', '/'
        if (-not $declared.ContainsKey($rel)) { $problems.Add("arquivo fora do manifesto: $rel") }
    }

    return $problems.ToArray()
}

# ═══════════════════════════════════════════════════════════════════════════════
# RETENÇÃO GFS — função PURA, testável offline
# ═══════════════════════════════════════════════════════════════════════════════

# Semana ISO-8601 sem depender de System.Globalization.ISOWeek (.NET Core+).
function Get-IsoWeekKey {
    param([datetime] $Date)
    $dow = [int]$Date.DayOfWeek
    if ($dow -eq 0) { $dow = 7 }                 # domingo = 7
    $thursday = $Date.Date.AddDays(4 - $dow)     # quinta da mesma semana ISO
    $cal = [System.Globalization.CultureInfo]::InvariantCulture.Calendar
    $week = $cal.GetWeekOfYear($thursday,
                [System.Globalization.CalendarWeekRule]::FirstFourDayWeek,
                [System.DayOfWeek]::Monday)
    return ('{0:D4}-W{1:D2}' -f $thursday.Year, $week)
}

<#
    Plano de retenção.

    Entrada: objetos com SetId, Reason, Timestamp, Sealed.
    Saída:   Keep / Delete / Skipped, com o motivo de cada decisão.

    Regras:
      - só sets SELADOS entram na decisão; os demais ficam em Skipped e NUNCA
        são apagados aqui;
      - `scheduled` obedece à UNIÃO de diário/semanal/mensal — um set que sirva
        às três categorias é um único diretório, e nunca é apagado por ter
        pertencido a mais de uma;
      - `prechange` tem piso próprio em dias e não ocupa vaga diária;
      - `manual` nunca é apagado automaticamente.
#>
function Get-RetentionPlan {
    param(
        [object[]] $Sets,
        [hashtable] $Policy,
        [datetime] $Now = (Get-Date)
    )

    $keep = New-Object System.Collections.Generic.List[object]
    $delete = New-Object System.Collections.Generic.List[object]
    $skipped = New-Object System.Collections.Generic.List[object]
    $reasons = @{}

    $sealed = @($Sets | Where-Object { $_.Sealed })
    foreach ($s in @($Sets | Where-Object { -not $_.Sealed })) {
        $skipped.Add($s); $reasons[$s.SetId] = 'sem selo — nunca é candidato'
    }

    $scheduled = @($sealed | Where-Object { $_.Reason -eq 'scheduled' } |
                   Sort-Object -Property Timestamp -Descending)

    $keepIds = New-Object System.Collections.Generic.HashSet[string]
    $why = @{}

    function Add-Keep([string] $id, [string] $motivo) {
        if (-not $keepIds.Contains($id)) { [void]$keepIds.Add($id) }
        if ($why.ContainsKey($id)) { $why[$id] += ('+' + $motivo) } else { $why[$id] = $motivo }
    }

    # diário — os N mais recentes
    $i = 0
    foreach ($s in $scheduled) {
        if ($i -ge $Policy.Daily) { break }
        Add-Keep $s.SetId 'diario'; $i++
    }

    # semanal — o mais recente de cada uma das últimas N semanas ISO
    $weekSeen = @{}
    $weekLimit = $Now.Date.AddDays(-7 * $Policy.Weeks)
    foreach ($s in $scheduled) {
        if ($s.Timestamp -lt $weekLimit) { continue }
        $k = Get-IsoWeekKey -Date $s.Timestamp
        if (-not $weekSeen.ContainsKey($k)) { $weekSeen[$k] = $true; Add-Keep $s.SetId ('semana:' + $k) }
    }

    # mensal — o mais recente de cada um dos últimos N meses
    $monthSeen = @{}
    $monthLimit = (Get-Date -Year $Now.Year -Month $Now.Month -Day 1).Date.AddMonths(-($Policy.Months - 1))
    foreach ($s in $scheduled) {
        if ($s.Timestamp -lt $monthLimit) { continue }
        $k = '{0:yyyy-MM}' -f $s.Timestamp
        if (-not $monthSeen.ContainsKey($k)) { $monthSeen[$k] = $true; Add-Keep $s.SetId ('mes:' + $k) }
    }

    foreach ($s in $scheduled) {
        if ($keepIds.Contains($s.SetId)) { $keep.Add($s); $reasons[$s.SetId] = $why[$s.SetId] }
        else { $delete.Add($s); $reasons[$s.SetId] = 'scheduled fora da janela GFS' }
    }

    # prechange — piso em dias; nunca ocupa vaga diária
    $preLimit = $Now.Date.AddDays(-$Policy.PrechangeDays)
    foreach ($s in @($sealed | Where-Object { $_.Reason -eq 'prechange' })) {
        if ($s.Timestamp -ge $preLimit) { $keep.Add($s); $reasons[$s.SetId] = 'prechange dentro do piso' }
        else { $keep.Add($s); $reasons[$s.SetId] = 'prechange além do piso — mantido, remoção só manual' }
    }

    # manual — nunca automático
    foreach ($s in @($sealed | Where-Object { $_.Reason -eq 'manual' })) {
        $keep.Add($s); $reasons[$s.SetId] = 'manual — remoção só manual'
    }

    # .ToArray() e nao @(): ver nota em New-Manifest.
    return [ordered]@{
        Keep = $keep.ToArray(); Delete = $delete.ToArray(); Skipped = $skipped.ToArray(); Reasons = $reasons
    }
}

function Read-BackupSet {
    param([string] $Dir)
    $seal = Join-Path $Dir $script:SealName
    $o = [ordered]@{ SetId = (Split-Path $Dir -Leaf); Path = $Dir; Sealed = $false
                     Reason = 'unknown'; Timestamp = [datetime]::MinValue }
    if (Test-Path -LiteralPath $seal) {
        try {
            $j = Get-Content -LiteralPath $seal -Raw -Encoding UTF8 | ConvertFrom-Json
            $o.Sealed = $true; $o.Reason = $j.reason; $o.Timestamp = [datetime]$j.timestamp
            $o.SetId = $j.setId
        } catch { $o.Sealed = $false }
    }
    return [pscustomobject]$o
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
function Invoke-PortalBackupMain {
    param([string] $Reason, [string] $Note, [string] $ConfigPath, [bool] $WhatIfRetention)

    $started = Get-Date
    $setId = $started.ToString('yyyy-MM-ddTHHmmss')
    $savedEnv = $null
    $exitCode = $script:EXIT.OK
    $externalCopy = 'not-attempted'
    $retentionState = 'not-attempted'
    $retentionDeleted = @()
    $setDir = $null
    $stagingDir = $null

    $cfg = Import-BackupConfig -Path $ConfigPath

    $root     = $cfg.BackupRoot
    $setsDir  = Join-Path $root 'sets'
    $stagRoot = Join-Path $root 'staging'
    $logsDir  = Join-Path $root 'logs'
    foreach ($d in @($root, $setsDir, $stagRoot, $logsDir)) {
        if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    }

    # Log e RUN-RESULT ficam FORA do set: o set selado é imutável.
    $script:LogPath = Join-Path $logsDir ("backup-{0}.log" -f $setId)
    $runResultPath  = Join-Path $logsDir ("RUN-RESULT-{0}.json" -f $setId)

    Write-Log ("=== backup {0} · reason={1} ===" -f $setId, $Reason) 'INFO'

    try {
        # ── [0] pré-checagem ──────────────────────────────────────────────────
        $tools = [ordered]@{
            PgDump    = Resolve-Tool $cfg.Tools.PgDump    'pg_dump.exe'
            PgDumpall = Resolve-Tool $cfg.Tools.PgDumpall 'pg_dumpall.exe'
            Psql      = Resolve-Tool $cfg.Tools.Psql      'psql.exe'
            Curl      = Resolve-Tool $cfg.Tools.Curl      'curl.exe'
            Tar       = Resolve-Tool $cfg.Tools.Tar       'tar.exe'
            Gpg       = Resolve-Tool $cfg.Tools.Gpg       'gpg.exe'
        }
        $toolVersions = [ordered]@{}
        foreach ($k in $tools.Keys) {
            Write-Log ("ferramenta {0} = {1}" -f $k, $tools[$k])
            $toolVersions[$k] = Get-ToolVersion $tools[$k]
        }

        # PgpassFile na config vence: sob Task Scheduler como SYSTEM o %APPDATA%
        # é outro, e cair no default silenciosamente daria "senha errada".
        $pgpass = if ($cfg.PgpassFile) { $cfg.PgpassFile } else { Join-Path $env:APPDATA 'postgresql\pgpass.conf' }
        Assert-SecretFile -Path $pgpass -Rotulo 'pgpass' -FailCode $script:EXIT.PgpassBad

        $savedEnv = Set-LibpqEnvironment -PgpassFile $pgpass
        Write-Log ("conexao host={0} port={1} db={2} user={3} sslmode=require" -f $cfg.Db.Host, $cfg.Db.Port, $cfg.Db.Database, $cfg.Db.User)

        $null = Invoke-PsqlScalarQuery -Psql $tools.Psql -Db $cfg.Db -Query 'SELECT 1;' -FailCode $script:EXIT.NoConnectivity
        Write-Log 'conectividade: ok' 'OK'

        # ── [1] staging ───────────────────────────────────────────────────────
        $stagingDir = Join-Path $stagRoot $setId
        New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

        $rolesPath     = Join-Path $stagingDir ("backup-portal-roles-{0}.sql" -f $setId)
        $schemaRawPath = Join-Path $stagingDir ("backup-portal-schema-{0}.raw.sql" -f $setId)
        $schemaPath    = Join-Path $stagingDir ("backup-portal-schema-{0}.sql" -f $setId)
        $dataRawPath   = Join-Path $stagingDir ("backup-portal-dados-{0}.raw.sql" -f $setId)
        $dataPath      = Join-Path $stagingDir ("backup-portal-dados-{0}.sql" -f $setId)

        $conn = @('--host', $cfg.Db.Host, '--port', $cfg.Db.Port, '--username', $cfg.Db.User, '--no-password')

        # ── [2] roles ─────────────────────────────────────────────────────────
        Invoke-Tool -Exe $tools.PgDumpall -Stage 'roles' -FailCode $script:EXIT.RolesFailed -Arguments (
            $conn + @('--dbname', $cfg.Db.Database, '--roles-only', '--no-role-passwords', '--file', $rolesPath))

        # ── [3] schema ────────────────────────────────────────────────────────
        # --quote-all-identifiers (PLURAL). O pg_dump nativo 18.6 rejeita o
        # singular que o Supabase CLI exibe no dry-run. Não "corrigir" de volta.
        $schemaExclude = 'information_schema|pg_*|_analytics|_realtime|_supavisor|auth|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault'
        Invoke-Tool -Exe $tools.PgDump -Stage 'schema' -FailCode $script:EXIT.SchemaFailed -Arguments (
            $conn + @('--dbname', $cfg.Db.Database, '--schema-only', '--quote-all-identifiers',
                      '--role', $cfg.Db.Role, '--exclude-schema', $schemaExclude, '--file', $schemaRawPath))
        Convert-SchemaDump -RawPath $schemaRawPath -OutPath $schemaPath
        Write-Log 'schema: 12 transformações aplicadas' 'OK'

        # ── [4] dados ─────────────────────────────────────────────────────────
        $dataExclude = 'information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor'
        Invoke-Tool -Exe $tools.PgDump -Stage 'dados' -FailCode $script:EXIT.DataFailed -Arguments (
            $conn + @('--dbname', $cfg.Db.Database, '--data-only', '--quote-all-identifiers',
                      '--role', $cfg.Db.Role, '--exclude-schema', $dataExclude,
                      '--exclude-table', 'auth.schema_migrations',
                      '--exclude-table', 'storage.migrations',
                      '--exclude-table', 'supabase_functions.migrations',
                      '--schema', '*', '--file', $dataRawPath))
        Convert-DataDump -RawPath $dataRawPath -OutPath $dataPath
        Write-Log 'dados: SET replica / RESET ALL aplicados' 'OK'

        # ── [5] storage ───────────────────────────────────────────────────────
        $storageDir = Join-Path $stagingDir 'storage'
        $storageReport = Invoke-StorageBackup -Tools $tools -Cfg $cfg -TargetDir $storageDir

        # ── [6] sanidade ──────────────────────────────────────────────────────
        $req = @($cfg.RequiredPublicTables)
        $ss = Get-SchemaSanity -SchemaSqlPath $schemaPath -RequiredTables $req
        if ($ss.InternalLeaks.Count -gt 0) {
            Stop-Stage ("schema gerenciado vazou para o dump: {0}" -f ($ss.InternalLeaks -join ', ')) $script:EXIT.SanityInternalLeak
        }
        if ($ss.MissingTables.Count -gt 0) {
            Stop-Stage ("tabelas public obrigatórias ausentes no schema: {0}" -f ($ss.MissingTables -join ', ')) $script:EXIT.SanitySchema
        }
        if ($ss.TotalPublic -lt $cfg.Baseline.SchemaPublicTables) {
            Stop-Stage ("tabelas public no schema abaixo do baseline: {0} < {1}" -f $ss.TotalPublic, $cfg.Baseline.SchemaPublicTables) $script:EXIT.SanitySchema
        }

        $ds = Get-DataSanity -DataSqlPath $dataPath -RequiredTables $req
        if (-not $ds.AuthUsersPresent) { Stop-Stage 'auth.users AUSENTE no dump de dados' $script:EXIT.SanityAuthUsers }
        if ($ds.MissingCopy.Count -gt 0) {
            Stop-Stage ("COPY ausente para tabelas obrigatórias: {0}" -f ($ds.MissingCopy -join ', ')) $script:EXIT.SanityCopy
        }
        if ($ds.CopyPublic -lt $cfg.Baseline.CopyPublic) {
            Stop-Stage ("COPY public abaixo do baseline: {0} < {1}" -f $ds.CopyPublic, $cfg.Baseline.CopyPublic) $script:EXIT.SanityCopy
        }
        if ($ds.CopyTotal -lt $cfg.Baseline.CopyTotal) {
            Stop-Stage ("COPY total abaixo do baseline: {0} < {1}" -f $ds.CopyTotal, $cfg.Baseline.CopyTotal) $script:EXIT.SanityCopy
        }
        Write-Log ("sanidade ok · schema public={0} · COPY public={1} · COPY total={2} · auth.users=sim" -f $ss.TotalPublic, $ds.CopyPublic, $ds.CopyTotal) 'OK'

        # ── [7] evidência + manifesto ─────────────────────────────────────────
        # A evidência entra no manifesto e, portanto, é IMUTÁVEL depois da selagem.
        # Nada de cópia externa/retenção/exit aqui — isso vive no RUN-RESULT.
        $evidencePath = Join-Path $stagingDir ("{0}-{1}.txt" -f $script:EvidencePrefix, $setId)
        $evidence = @(
            "Backup do Portal — evidência de execução"
            "setId:      $setId"
            "reason:     $Reason"
            "note:       $Note"
            "iniciado:   $($started.ToString('o'))"
            ""
            "Conexão:    host=$($cfg.Db.Host) port=$($cfg.Db.Port) db=$($cfg.Db.Database) user=$($cfg.Db.User) sslmode=require"
            "Credencial: %APPDATA%\postgresql\pgpass.conf (PGPASSFILE) — não lida nem registrada"
            ""
            "Ferramentas:"
        ) + @($toolVersions.Keys | ForEach-Object { "  $_ = $($toolVersions[$_])" }) + @(
            ""
            "Schema:"
            "  tabelas public obrigatórias: $($req.Count)/$($req.Count) presentes"
            "  total de tabelas public:     $($ss.TotalPublic) (baseline >= $($cfg.Baseline.SchemaPublicTables))"
            "  schemas gerenciados vazados: nenhum"
            ""
            "Dados:"
            "  auth.users:      presente"
            "  COPY public:     $($ds.CopyPublic) (baseline >= $($cfg.Baseline.CopyPublic))"
            "  COPY total:      $($ds.CopyTotal) (baseline >= $($cfg.Baseline.CopyTotal))"
            ""
            "Storage:"
            "  buckets:         $($storageReport.Buckets -join ', ')"
            "  objetos listados: $($storageReport.Expected)"
            "  objetos baixados: $($storageReport.Downloaded)"
            "  tamanhos conferem: $($storageReport.SizesMatch)"
            ""
            "Restauração: este conjunto foi validado localmente. O restore integral"
            "da plataforma Supabase (auth/storage gerenciados) NÃO é coberto aqui."
        ) -join "`r`n"
        Write-TextFileUtf8NoBom $evidencePath $evidence

        $artifacts = New-Manifest -SetDir $stagingDir
        Write-Log ("manifesto: {0} artefatos" -f $artifacts.Count) 'OK'

        # ── [8] selagem ───────────────────────────────────────────────────────
        $problems = Test-Manifest -SetDir $stagingDir
        if ($problems.Count -gt 0) {
            Stop-Stage ("revalidação do manifesto falhou: {0}" -f ($problems -join '; ')) $script:EXIT.SealFailed
        }

        $seal = [ordered]@{
            timestamp = $started.ToString('o')
            setId     = $setId
            reason    = $Reason
            note      = $Note
            tools     = $toolVersions
            artifacts = $artifacts
            validations = [ordered]@{
                schemaRequiredTables   = $req.Count
                schemaTotalPublic      = $ss.TotalPublic
                schemaBaseline         = $cfg.Baseline.SchemaPublicTables
                internalSchemasAbsent  = $true
                copyPublic             = $ds.CopyPublic
                copyTotal              = $ds.CopyTotal
                copyBaselinePublic     = $cfg.Baseline.CopyPublic
                copyBaselineTotal      = $cfg.Baseline.CopyTotal
                authUsersPresent       = $true
                storage                = $storageReport
            }
            durationSeconds = [int]((Get-Date) - $started).TotalSeconds
            meaning = 'Este conjunto LOCAL passou integralmente nas validações. Não afirma nada sobre a cópia externa.'
        }
        Write-TextFileUtf8NoBom (Join-Path $stagingDir $script:SealName) (($seal | ConvertTo-Json -Depth 8))

        $setDir = Join-Path $setsDir $setId
        Move-Item -LiteralPath $stagingDir -Destination $setDir
        $stagingDir = $null
        Write-Log ("set selado: {0}" -f $setDir) 'OK'

        # ── [9] cópia externa ─────────────────────────────────────────────────
        Invoke-ExternalCopy -Tools $tools -Cfg $cfg -SetDir $setDir -SetId $setId -WhatIfRetention:$WhatIfRetention
        $externalCopy = 'success'
        Write-Log 'cópia externa: validada por hash na origem e no destino' 'OK'

        # ── [10] retenção ─────────────────────────────────────────────────────
        $ret = Invoke-Retention -Cfg $cfg -SetsDir $setsDir -StagingRoot $stagRoot -WhatIf:$WhatIfRetention
        $retentionState = if ($WhatIfRetention) { 'whatif' } else { 'applied' }
        $retentionDeleted = $ret.Deleted
    }
    catch {
        $exitCode = if ($_.Exception -is [BackupStageError]) { $_.Exception.Code } else { 1 }
        Write-Log ("FALHA: {0}" -f $_.Exception.Message) 'ERRO'
        if ($exitCode -eq $script:EXIT.ExternalCopy) { $externalCopy = 'failed' }
        Write-Log 'retenção NÃO executada por causa da falha' 'WARN'
    }
    finally {
        if ($savedEnv) { Restore-LibpqEnvironment -Saved $savedEnv }

        # RUN-RESULT vive em logs\, FORA do set. O set selado é imutável.
        $runResult = [ordered]@{
            setId            = $setId
            reason           = $Reason
            startedAt        = $started.ToString('o')
            finishedAt       = (Get-Date).ToString('o')
            durationSeconds  = [int]((Get-Date) - $started).TotalSeconds
            exitCode         = $exitCode
            sealedSetPath    = $setDir
            externalCopy     = $externalCopy
            retention        = $retentionState
            retentionDeleted = @($retentionDeleted)
            logPath          = $script:LogPath
        }
        Write-TextFileUtf8NoBom $runResultPath (($runResult | ConvertTo-Json -Depth 6))
        Write-Log ("=== fim · exit={0} · externalCopy={1} · retention={2} ===" -f $exitCode, $externalCopy, $retentionState)

        if ($stagingDir -and (Test-Path -LiteralPath $stagingDir)) {
            Write-Log ("staging mantido para diagnóstico: {0}" -f $stagingDir) 'WARN'
            Remove-OldStaging -StagingRoot $stagRoot -Keep $cfg.Retention.StagingKeep
        }
    }

    return $exitCode
}

function Remove-OldStaging {
    param([string] $StagingRoot, [int] $Keep)
    $dirs = @(Get-ChildItem -LiteralPath $StagingRoot -Directory -ErrorAction SilentlyContinue |
              Sort-Object Name -Descending)
    if ($dirs.Count -le $Keep) { return }
    foreach ($d in $dirs[$Keep..($dirs.Count - 1)]) {
        Write-Log ("staging antigo removido: {0}" -f $d.Name)
        Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# STORAGE — descoberta obrigatória antes do download
# ═══════════════════════════════════════════════════════════════════════════════
function Invoke-StorageBackup {
    param([hashtable] $Tools, [hashtable] $Cfg, [string] $TargetDir)

    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    $configured = @($Cfg.StorageBuckets)

    # 1) buckets que TÊM objetos, direto do banco
    $rows = Invoke-PsqlScalarQuery -Psql $Tools.Psql -Db $Cfg.Db -FailCode $script:EXIT.StorageDownload -Query @'
select b.id, b.public::text, count(o.id)::text
from storage.buckets b left join storage.objects o on o.bucket_id = b.id
group by b.id, b.public order by b.id;
'@
    $buckets = @()
    foreach ($r in $rows) {
        $p = $r -split "`t"
        if ($p.Count -lt 3) { continue }
        $buckets += [pscustomobject]@{ Id = $p[0].Trim(); Public = ($p[1].Trim() -eq 'true'); Objects = [int]$p[2].Trim() }
    }

    # 2) bucket com objetos fora da configuração ⇒ FALHA.
    #    É isto que impede a rotina de ficar verde depois que alguém cria um
    #    bucket novo e esquece de adicioná-lo ao backup.
    $unknown = @($buckets | Where-Object { $_.Objects -gt 0 -and $configured -notcontains $_.Id })
    if ($unknown.Count -gt 0) {
        Stop-Stage ("bucket com objetos fora da configuração: {0} — adicione a StorageBuckets" -f (($unknown | ForEach-Object { $_.Id }) -join ', ')) $script:EXIT.StorageUnknownBkt
    }

    # 3) bucket configurado que deixou de ser público ⇒ FALHA (não ignorar)
    foreach ($id in $configured) {
        $b = $buckets | Where-Object { $_.Id -eq $id } | Select-Object -First 1
        if (-not $b) { Stop-Stage ("bucket configurado não existe: {0}" -f $id) $script:EXIT.StorageUnknownBkt }
        if (-not $b.Public) { Stop-Stage ("bucket configurado deixou de ser público: {0}" -f $id) $script:EXIT.StorageNotPublic }
    }

    # 4) listagem — fonte da verdade desta execução
    $expected = 0; $downloaded = 0; $sizesMatch = $true
    foreach ($id in $configured) {
        $objRows = Invoke-PsqlScalarQuery -Psql $Tools.Psql -Db $Cfg.Db -FailCode $script:EXIT.StorageDownload -Query (@'
select o.name, coalesce((o.metadata->>'size')::bigint, 0)::text
from storage.objects o where o.bucket_id = '{0}' order by o.name;
'@ -f $id.Replace("'", "''"))

        $bucketDir = Join-Path $TargetDir $id
        New-Item -ItemType Directory -Path $bucketDir -Force | Out-Null

        foreach ($row in $objRows) {
            $parts = $row -split "`t"
            if ($parts.Count -lt 2) { continue }
            $name = $parts[0]; $size = [int64]$parts[1]
            $expected++

            $url = Get-PublicObjectUrl -SupabaseUrl $Cfg.SupabaseUrl -Bucket $id -ObjectName $name
            $dest = Get-LocalObjectPath -BucketDir $bucketDir -ObjectName $name -FailCode $script:EXIT.StorageUnsafeName
            New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null

            $r = Invoke-NativeCommand -Exe $Tools.Curl -Arguments @(
                '--fail', '--location', '--silent', '--show-error', '--output', $dest, $url)
            if ($r.ExitCode -ne 0) {
                Stop-Stage ("download falhou: {0}/{1} (curl {2}): {3}" -f $id, $name, $r.ExitCode, (Get-StdErrTail $r.StdErr)) $script:EXIT.StorageDownload
            }
            if (-not (Test-Path -LiteralPath $dest)) {
                Stop-Stage ("curl retornou 0 mas o arquivo não existe: {0}/{1}" -f $id, $name) $script:EXIT.StorageDownload
            }
            $downloaded++

            $local = (Get-Item -LiteralPath $dest).Length
            if ($size -gt 0 -and $local -ne $size) {
                $sizesMatch = $false
                Stop-Stage ("tamanho divergente: {0}/{1} local={2} storage.objects={3}" -f $id, $name, $local, $size) $script:EXIT.StorageMismatch
            }
        }
    }

    if ($downloaded -ne $expected) {
        Stop-Stage ("contagem divergente: baixados={0} listados={1}" -f $downloaded, $expected) $script:EXIT.StorageMismatch
    }
    Write-Log ("storage: {0} objeto(s) em {1} bucket(s), tamanhos conferidos" -f $downloaded, $configured.Count) 'OK'

    return [ordered]@{ Buckets = $configured; Expected = $expected; Downloaded = $downloaded; SizesMatch = $sizesMatch }
}

# ═══════════════════════════════════════════════════════════════════════════════
# CÓPIA EXTERNA — tar → gpg AES256 → hash → copiar → hash no destino → comparar
# ═══════════════════════════════════════════════════════════════════════════════
function Invoke-ExternalCopy {
    param([hashtable] $Tools, [hashtable] $Cfg, [string] $SetDir, [string] $SetId, [switch] $WhatIfRetention)

    if (-not $Cfg.ExternalBackupRoot) {
        Stop-Stage 'ExternalBackupRoot não configurado — a segunda cópia é obrigatória' $script:EXIT.ExternalCopy
    }
    if (-not $Cfg.GpgPassphraseFile) {
        Stop-Stage 'GpgPassphraseFile não configurado — necessário para cifrar a cópia externa' $script:EXIT.ExternalCopy
    }
    # A passphrase tem a MESMA disciplina de ACL do pgpass, e é verificada —
    # documentar que o humano deve restringi-la não é controle nenhum.
    Assert-SecretFile -Path $Cfg.GpgPassphraseFile -Rotulo 'passphrase do GPG' -FailCode $script:EXIT.ExternalCopy

    if (-not (Test-Path -LiteralPath $Cfg.ExternalBackupRoot)) {
        Stop-Stage ("destino externo inacessível: {0}" -f $Cfg.ExternalBackupRoot) $script:EXIT.ExternalCopy
    }

    # Área de trabalho FORA do set selado — o set nunca recebe escrita depois da
    # selagem, nem sequer um arquivo temporário.
    $work = Join-Path $env:TEMP ("portal-backup-" + $SetId)
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $tarPath = Join-Path $work ("{0}.tar" -f $SetId)
    $gpgPath = "$tarPath.gpg"

    try {
        # tar do set SELADO, com o diretório-pai como raiz do arquivo. Somente leitura.
        $r = Invoke-NativeCommand -Exe $Tools.Tar -Arguments @('-cf', $tarPath, '-C', (Split-Path $SetDir -Parent), $SetId)
        if ($r.ExitCode -ne 0) {
            Stop-Stage ("tar falhou (código {0}): {1}" -f $r.ExitCode, (Get-StdErrTail $r.StdErr)) $script:EXIT.ExternalCopy
        }

        # --pinentry-mode loopback é OBRIGATÓRIO: sem ele o gpg2 tenta abrir o
        # pinentry e ignora o --passphrase-file, travando ou falhando em batch.
        # A passphrase entra POR ARQUIVO, nunca como argumento — argumento de
        # processo é legível por qualquer processo da máquina.
        $r = Invoke-NativeCommand -Exe $Tools.Gpg -Arguments @(
            '--batch', '--yes', '--pinentry-mode', 'loopback',
            '--passphrase-file', $Cfg.GpgPassphraseFile,
            '--symmetric', '--cipher-algo', 'AES256',
            '--output', $gpgPath, $tarPath)
        if ($r.ExitCode -ne 0) {
            Stop-Stage ("gpg falhou (código {0}): {1}" -f $r.ExitCode, (Get-StdErrTail $r.StdErr)) $script:EXIT.ExternalCopy
        }
        if (-not (Test-Path -LiteralPath $gpgPath)) {
            Stop-Stage 'gpg retornou 0 mas não produziu o arquivo cifrado' $script:EXIT.ExternalCopy
        }

        # O tar em claro some assim que existe a versão cifrada. O `finally`
        # abaixo cobre o caso de falha antes disto.
        Remove-Item -LiteralPath $tarPath -Force
        Write-Log 'cópia externa: tar em claro removido após cifragem'

        $hashLocal = Get-FileSha256 -Path $gpgPath

        $destDir = Join-Path $Cfg.ExternalBackupRoot 'sets'
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        $destFile = Join-Path $destDir ("{0}.tar.gpg" -f $SetId)
        Copy-Item -LiteralPath $gpgPath -Destination $destFile -Force

        $hashRemote = Get-FileSha256 -Path $destFile
        if ($hashLocal -ne $hashRemote) {
            Stop-Stage ("hash da cópia externa não confere: local={0} destino={1}" -f $hashLocal, $hashRemote) $script:EXIT.ExternalCopy
        }
        Write-TextFileUtf8NoBom ("$destFile.sha256") ("{0}  {1}.tar.gpg`n" -f $hashLocal, $SetId)
        Write-Log ("cópia externa: {0} — hash idêntico nos dois lados" -f $destFile) 'OK'

        # Só agora, com a cópia NOVA confirmada nos dois lados, se poda o antigo.
        Invoke-ExternalRetention -Cfg $Cfg -ExternalSetsDir $destDir `
                                 -LocalSetsDir (Split-Path $SetDir -Parent) -WhatIf:$WhatIfRetention
    }
    finally {
        # Remove a área inteira: cobre o tar em claro se a cifragem falhou no meio.
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

<#
    Retenção externa — mesma política, mesmos setIds.

    Remove SOMENTE o que o plano local marcou explicitamente como Delete. Um
    `.tar.gpg` órfão (cujo set local já não existe) é REGISTRADO e mantido, nunca
    apagado por dedução: o set local pode ter sido movido ou removido à mão, e
    apagar a única cópia restante por causa disso seria destruir backup bom.
#>
function Invoke-ExternalRetention {
    param([hashtable] $Cfg, [string] $ExternalSetsDir, [string] $LocalSetsDir, [switch] $WhatIf)

    $localSets = @(Get-ChildItem -LiteralPath $LocalSetsDir -Directory -ErrorAction SilentlyContinue |
                   ForEach-Object { Read-BackupSet -Dir $_.FullName })
    $plan = Get-RetentionPlan -Sets $localSets -Policy $Cfg.Retention
    $deleteIds = @($plan.Delete | ForEach-Object { $_.SetId })
    $knownIds  = @($localSets   | ForEach-Object { $_.SetId })

    foreach ($f in @(Get-ChildItem -LiteralPath $ExternalSetsDir -Filter '*.tar.gpg' -File -ErrorAction SilentlyContinue)) {
        $id = $f.Name -replace '\.tar\.gpg$', ''

        if ($knownIds -notcontains $id) {
            Write-Log ("retenção externa: {0} sem set local correspondente — MANTIDO" -f $f.Name) 'WARN'
            continue
        }
        if ($deleteIds -notcontains $id) { continue }

        if ($WhatIf) {
            Write-Log ("retenção externa: [WhatIf] REMOVERIA {0}" -f $f.Name)
            continue
        }
        Write-Log ("retenção externa: removendo {0}" -f $f.Name)
        Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath ($f.FullName + '.sha256') -Force -ErrorAction SilentlyContinue
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# RETENÇÃO LOCAL
# ═══════════════════════════════════════════════════════════════════════════════
function Invoke-Retention {
    param([hashtable] $Cfg, [string] $SetsDir, [string] $StagingRoot, [switch] $WhatIf)

    $sets = @(Get-ChildItem -LiteralPath $SetsDir -Directory -ErrorAction SilentlyContinue |
              ForEach-Object { Read-BackupSet -Dir $_.FullName })
    $plan = Get-RetentionPlan -Sets $sets -Policy $Cfg.Retention

    Write-Log ("retenção: {0} mantidos, {1} a remover, {2} sem selo (ignorados)" -f $plan.Keep.Count, $plan.Delete.Count, $plan.Skipped.Count)
    foreach ($s in $plan.Keep)    { Write-Log ("  MANTER  {0}  ({1})" -f $s.SetId, $plan.Reasons[$s.SetId]) }
    foreach ($s in $plan.Skipped) { Write-Log ("  IGNORAR {0}  ({1})" -f $s.SetId, $plan.Reasons[$s.SetId]) 'WARN' }

    $deleted = @()
    foreach ($s in $plan.Delete) {
        if ($WhatIf) { Write-Log ("  [WhatIf] REMOVERIA {0}  ({1})" -f $s.SetId, $plan.Reasons[$s.SetId]) }
        else {
            Write-Log ("  REMOVER {0}  ({1})" -f $s.SetId, $plan.Reasons[$s.SetId])
            Remove-Item -LiteralPath $s.Path -Recurse -Force
            $deleted += $s.SetId
        }
    }
    return [ordered]@{ Plan = $plan; Deleted = $deleted }
}

# ═══════════════════════════════════════════════════════════════════════════════
if (-not $LoadFunctionsOnly) {
    exit (Invoke-PortalBackupMain -Reason $Reason -Note $Note -ConfigPath $ConfigPath -WhatIfRetention:$WhatIfRetention.IsPresent)
}
