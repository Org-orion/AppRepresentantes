@{
    # ─────────────────────────────────────────────────────────────────────────
    # Configuração da rotina de backup do Portal — MODELO.
    #
    # Copie para `backup.config.psd1` (gitignored) e ajuste.
    #
    # ⚠️ NENHUM SEGREDO AQUI. Nada de senha, DB_URL, token ou service key.
    #    A senha do banco vem EXCLUSIVAMENTE de %APPDATA%\postgresql\pgpass.conf.
    #    A passphrase do GPG vem EXCLUSIVAMENTE do arquivo apontado em
    #    GpgPassphraseFile, que também fica fora do repositório.
    # ─────────────────────────────────────────────────────────────────────────

    # ── Conexão ── nenhum destes quatro é segredo ────────────────────────────
    # Session Pooler. A conexão direta por IPv6 não funciona nesta rede.
    Db = @{
        Host     = 'aws-1-sa-east-1.pooler.supabase.com'
        Port     = 5432
        Database = 'postgres'
        User     = 'postgres.ikjeyaxfciferyezxskh'
        # Repassado ao pg_dump/pg_dumpall como --role
        Role     = 'postgres'
    }

    # URL pública do projeto, usada para baixar objetos de bucket público.
    # Não é segredo: já vai no bundle do frontend.
    SupabaseUrl = 'https://ikjeyaxfciferyezxskh.supabase.co'

    # ── Destinos ─────────────────────────────────────────────────────────────
    # Raiz local. `sets\`, `staging\` e `logs\` são criados aqui.
    BackupRoot = 'C:\Users\1kmz\AppRepresentatives-Backups'

    # Segunda cópia, FORA desta máquina. Obrigatório em execução operacional.
    # Deixe vazio apenas para desenvolvimento; a execução normal falha (exit 60).
    ExternalBackupRoot = ''

    # Arquivo com a passphrase do GPG. Caminho ABSOLUTO.
    # A ACL é VERIFICADA a cada execução, com a mesma disciplina do pgpass:
    # qualquer ACE Allow fora de {usuário atual, SYSTEM} derruba a execução.
    # NÃO versionar. NÃO colocar dentro do repositório.
    GpgPassphraseFile = ''

    # ── Credencial do banco ──────────────────────────────────────────────────
    # Caminho ABSOLUTO do .pgpass. Vazio = %APPDATA%\postgresql\pgpass.conf.
    # Preencha ANTES de agendar no Task Scheduler: uma tarefa que roda como
    # SYSTEM tem outro %APPDATA%, e o default apontaria para o arquivo errado.
    # O arquivo em si NUNCA é lido pelo script — só o libpq o lê. Aqui vai o
    # CAMINHO, jamais a senha.
    PgpassFile = ''

    # ── Storage ──────────────────────────────────────────────────────────────
    # Declaração de intenção. NUNCA substitui a descoberta: antes de baixar, a
    # rotina consulta storage.buckets/storage.objects e FALHA se existir bucket
    # com objetos fora desta lista (exit 32), ou se um bucket daqui deixar de
    # ser público (exit 33).
    StorageBuckets = @('avatars')

    # ── Sanidade ─────────────────────────────────────────────────────────────
    # Tabelas que DEVEM existir no schema e ter bloco COPY no dump de dados.
    # Ausência de qualquer uma derruba a execução.
    RequiredPublicTables = @(
        '_import_usuarios'
        'client_groups'
        'concremapprep_notificacoes'
        'concremapprep_orcamento_itens'
        'concremapprep_orcamentos'
        'concremapprep_representantes'
        'concremapprep_usuario_representantes'
        'concremapprep_usuarios'
        'pedidos_status_historico'
        'user_client_groups'
    )

    # Baselines medidos no backup validado de 2026-08-25.
    # São PISO, nunca igualdade: detectam regressão, não impedem crescimento.
    # Revisar (para cima) quando o banco crescer de propósito.
    Baseline = @{
        Source            = 'backup validado em 2026-08-25'
        SchemaPublicTables = 10
        CopyPublic         = 10
        CopyTotal          = 39
    }

    # ── Retenção GFS ─────────────────────────────────────────────────────────
    # Aplicada SOMENTE a sets `scheduled`. O conjunto mantido é a UNIÃO das três
    # categorias; um set que sirva às três continua sendo um único diretório.
    Retention = @{
        Daily          = 7   # 7 sets scheduled mais recentes
        Weeks          = 4   # 1 por semana ISO, últimas 4
        Months         = 3   # 1 por mês, últimos 3
        PrechangeDays  = 7   # piso de retenção dos sets `prechange`
        StagingKeep    = 3   # stagings de execuções falhas mantidos p/ diagnóstico
    }

    # ── Ferramentas ──────────────────────────────────────────────────────────
    # Caminhos ABSOLUTOS. Vazio = resolve uma vez via Get-Command e registra no
    # log o caminho resolvido — esse fallback existe para uso MANUAL.
    #
    # ANTES de agendar no Task Scheduler estes caminhos DEVEM estar preenchidos:
    # a tarefa agendada não herda o PATH da sua sessão, e o fallback falharia
    # com "ferramenta não encontrada" (exit 10) no meio da madrugada.
    Tools = @{
        PgDump     = ''
        PgDumpall  = ''
        Psql       = ''
        Curl       = ''   # curl.exe, não o alias do PowerShell
        Tar        = ''
        Gpg        = ''
    }
}
