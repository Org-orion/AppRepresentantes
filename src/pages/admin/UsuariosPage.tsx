import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, X, Check, ShieldCheck, User as UserIcon, ToggleLeft, ToggleRight, ClipboardCheck, KeyRound, Eye, EyeOff, Briefcase, Crown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import PageContainer from '@/components/ui/PageContainer';
import { cn } from '@/utils/cn';
import type { RepresentanteERP, Usuario, Perfil } from '@/types';
import {
  fetchUsuarios,
  updateUsuario,
  updateSenha,
  linkRepresentante,
  unlinkRepresentante,
  createUsuarioCompleto,
  saveUsuarioAcesso,
  type UsuarioComReps,
} from '@/services/usuarios';
import { fetchRepresentantes } from '@/services/representantes';
import { fetchClientGroups } from '@/services/clientGroups';
import { perfilDoUsuario, PERFIL_LABEL } from '@/constants/perfis';

// ─── Tipo do usuário ───────────────────────────────────
type TipoUsuario = Perfil;

function getTipo(u: Usuario): TipoUsuario {
  return perfilDoUsuario(u);
}

// ─── Seletor de tipo ───────────────────────────────────
function TipoSelector({ value, onChange }: { value: TipoUsuario; onChange: (t: TipoUsuario) => void }) {
  const tipos: { key: TipoUsuario; label: string; desc: string; icon: React.ElementType; color: string }[] = [
    { key: 'representante',  label: 'Representante',  desc: 'Cria e envia orçamentos',      icon: UserIcon,      color: 'border-blue-300 bg-blue-50 text-blue-700'     },
    { key: 'operador',       label: 'Operador',       desc: 'Aprova e rejeita orçamentos',  icon: ClipboardCheck, color: 'border-sky-300 bg-sky-50 text-sky-700'        },
    { key: 'admin',          label: 'Administrador',  desc: 'Acesso total ao painel',       icon: ShieldCheck,   color: 'border-amber-300 bg-amber-50 text-amber-700'  },
    { key: 'diretor',        label: 'Diretor',        desc: 'Vê os grupos vinculados',      icon: Briefcase,     color: 'border-indigo-300 bg-indigo-50 text-indigo-700' },
    { key: 'diretor_geral',  label: 'Diretor Geral',  desc: 'Vê todos os grupos',           icon: Crown,         color: 'border-violet-300 bg-violet-50 text-violet-700' },
  ];

  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 mb-2 block">Tipo de acesso</label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tipos.map(({ key, label, desc, icon: Icon, color }) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              'flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center',
              value === key ? color + ' border-opacity-100' : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300'
            )}
          >
            <Icon className="w-5 h-5" />
            <span className="text-xs font-semibold leading-tight">{label}</span>
            <span className="text-[10px] leading-tight opacity-70">{desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Multi-select de grupos (perfil Diretor) ───────────
function GrupoMultiSelect({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { data: grupos = [], isLoading } = useQuery({ queryKey: ['client-groups'], queryFn: fetchClientGroups });
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 mb-2 block">
        Grupos de clientes <span className="text-red-500">*</span>
      </label>
      {isLoading ? (
        <p className="text-xs text-gray-400">Carregando grupos…</p>
      ) : grupos.length === 0 ? (
        <p className="text-xs text-amber-600">Nenhum grupo cadastrado (aplique a migração de grupos no banco).</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {grupos.filter(g => g.is_active).map(g => {
            const on = value.includes(g.id);
            return (
              <button key={g.id} type="button" onClick={() => toggle(g.id)}
                className={cn('text-xs font-medium px-2.5 py-1 rounded-full border transition-colors',
                  on ? 'bg-[hsl(142,93%,8%)] text-white border-[hsl(142,93%,8%)]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300')}>
                {g.name}
              </button>
            );
          })}
        </div>
      )}
      {value.length === 0 && <p className="text-[11px] text-gray-400 mt-1.5">Selecione ao menos 1 grupo.</p>}
    </div>
  );
}

// ─── Modal Criar Usuário ───────────────────────────────
function CriarModal({
  onClose, onSave, saving, error,
}: {
  onClose: () => void;
  onSave: (nome: string, email: string, senha: string, perfil: TipoUsuario, grupoIds: string[]) => void;
  saving: boolean;
  error?: string;
}) {
  const [nome,  setNome]  = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [tipo,  setTipo]  = useState<TipoUsuario>('representante');
  const [grupoIds, setGrupoIds] = useState<string[]>([]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Novo Usuário</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Nome completo</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Lillian Silva"
              name="nu-nome" autoComplete="off"
              className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">E-mail</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="lillian@concrem.com.br"
              name="nu-email" autoComplete="off"
              className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Senha provisória</label>
            <input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••••"
              name="nu-senha" autoComplete="new-password"
              className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]" />
          </div>

          <TipoSelector value={tipo} onChange={setTipo} />

          {tipo === 'diretor' && <GrupoMultiSelect value={grupoIds} onChange={setGrupoIds} />}
          {tipo === 'diretor_geral' && (
            <p className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
              Diretor Geral possui acesso completo a todos os grupos.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="h-9 px-4 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={() => onSave(nome, email, senha, tipo, grupoIds)}
            disabled={saving || !nome || !email || !senha || (tipo === 'diretor' && grupoIds.length === 0)}
            className="h-9 px-4 text-sm bg-[hsl(142,93%,8%)] text-white rounded-lg hover:bg-[hsl(142,93%,15%)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            <Check className="w-3.5 h-3.5" />
            Criar usuário
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Editar Usuário ──────────────────────────────
function EditarModal({
  usuario, todosReps, onClose, saving, onUpdate, onLink, onUnlink, onAlterarSenha, savingSenha, senhaError, senhaSucesso, acessoError,
}: {
  usuario: UsuarioComReps;
  todosReps: RepresentanteERP[];
  onClose: () => void;
  saving: boolean;
  onUpdate: (nome: string, perfil: TipoUsuario, grupoIds: string[]) => void;
  onLink: (repId: string) => void;
  onUnlink: (repId: string) => void;
  onAlterarSenha: (novaSenha: string) => void;
  savingSenha: boolean;
  senhaError?: string;
  senhaSucesso?: boolean;
  acessoError?: string;
}) {
  const [nome, setNome] = useState(usuario.nome);
  const [tipo, setTipo] = useState<TipoUsuario>(getTipo(usuario));
  const [grupoIds, setGrupoIds] = useState<string[]>(usuario.grupoIds ?? []);
  const [showSenha, setShowSenha] = useState(false);
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [mostrarSenhaTexto, setMostrarSenhaTexto] = useState(false);

  // Ao confirmar com sucesso, limpa os campos de senha.
  useEffect(() => {
    if (senhaSucesso) { setNovaSenha(''); setConfirmarSenha(''); }
  }, [senhaSucesso]);

  const linkedIds = new Set(usuario.reps.map(r => r.id));
  const ativos = todosReps.filter(r => r.ativo);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-bold text-gray-900">Editar Usuário</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">E-mail</label>
            <input value={usuario.email} disabled
              className="w-full h-9 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-400" />
          </div>

          <TipoSelector value={tipo} onChange={setTipo} />

          {tipo === 'diretor' && <GrupoMultiSelect value={grupoIds} onChange={setGrupoIds} />}
          {tipo === 'diretor_geral' && (
            <p className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
              Diretor Geral possui acesso completo a todos os grupos.
            </p>
          )}

          {/* Vínculos com rep codes — só para representante */}
          {tipo === 'representante' && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">Representantes vinculados</p>
              {ativos.length === 0 ? (
                <p className="text-xs text-gray-400">Nenhum representante ativo cadastrado.</p>
              ) : (
                <div className="space-y-1.5">
                  {ativos.map(rep => {
                    const linked = linkedIds.has(rep.id);
                    return (
                      <label key={rep.id} className="flex items-center gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                        <input type="checkbox" checked={linked}
                          onChange={() => linked ? onUnlink(rep.id) : onLink(rep.id)}
                          className="w-4 h-4 rounded accent-[hsl(142,93%,8%)]" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{rep.nome_erp}</p>
                          <p className="text-xs text-gray-400 font-mono truncate">{rep.representante_erp}</p>
                        </div>
                        <span className="text-xs text-gray-500 flex-shrink-0">{rep.comissao_percentual}%</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {/* Alterar senha */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => { setShowSenha(v => !v); setNovaSenha(''); setConfirmarSenha(''); }}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-gray-400" />
                Alterar senha
              </span>
              <span className={cn('text-xs px-2 py-0.5 rounded-full', showSenha ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500')}>
                {showSenha ? 'cancelar' : 'alterar'}
              </span>
            </button>

            {showSenha && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                {senhaError && (
                  <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{senhaError}</p>
                )}
                {senhaSucesso && !senhaError && (
                  <p className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                    <Check className="w-3.5 h-3.5" />
                    Senha alterada com sucesso.
                  </p>
                )}
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Nova senha</label>
                  <div className="relative">
                    <input
                      type={mostrarSenhaTexto ? 'text' : 'password'}
                      value={novaSenha}
                      onChange={e => setNovaSenha(e.target.value)}
                      placeholder="••••••••"
                      className="w-full h-9 px-3 pr-9 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]"
                    />
                    <button type="button" onClick={() => setMostrarSenhaTexto(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {mostrarSenhaTexto ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Confirmar senha</label>
                  <input
                    type={mostrarSenhaTexto ? 'text' : 'password'}
                    value={confirmarSenha}
                    onChange={e => setConfirmarSenha(e.target.value)}
                    placeholder="••••••••"
                    className={cn(
                      'w-full h-9 px-3 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]',
                      confirmarSenha && novaSenha !== confirmarSenha ? 'border-red-300' : 'border-gray-300'
                    )}
                  />
                  {confirmarSenha && novaSenha !== confirmarSenha && (
                    <p className="text-[10px] text-red-500 mt-1">As senhas não coincidem</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onAlterarSenha(novaSenha)}
                  disabled={savingSenha || !novaSenha || novaSenha !== confirmarSenha}
                  className="w-full h-9 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                >
                  {savingSenha && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  <KeyRound className="w-3.5 h-3.5" />
                  Confirmar nova senha
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          {acessoError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {acessoError}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Fechar
          </button>
          <button
            onClick={() => onUpdate(nome, tipo, grupoIds)}
            disabled={saving || !nome || (tipo === 'diretor' && grupoIds.length === 0)}
            className="h-9 px-4 text-sm bg-[hsl(142,93%,8%)] text-white rounded-lg hover:bg-[hsl(142,93%,15%)] disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            <Check className="w-3.5 h-3.5" />
            Salvar
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Badge de tipo ─────────────────────────────────────
const TIPO_BADGE: Record<Perfil, { cls: string; icon: React.ElementType }> = {
  admin:         { cls: 'bg-amber-50 text-amber-700 border-amber-200',    icon: ShieldCheck },
  operador:      { cls: 'bg-sky-50 text-sky-700 border-sky-200',          icon: ClipboardCheck },
  diretor:       { cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: Briefcase },
  diretor_geral: { cls: 'bg-violet-50 text-violet-700 border-violet-200', icon: Crown },
  representante: { cls: 'bg-blue-50 text-blue-700 border-blue-200',        icon: UserIcon },
};

function TipoBadge({ u }: { u: UsuarioComReps }) {
  const p = perfilDoUsuario(u);
  const c = TIPO_BADGE[p];
  const Icon = c.icon;
  return (
    <span className={cn('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium border', c.cls)}>
      <Icon className="w-2.5 h-2.5" />{PERFIL_LABEL[p]}
    </span>
  );
}

// ─── Página ────────────────────────────────────────────
export default function AdminUsuariosPage() {
  const qc = useQueryClient();
  const [showCriar, setShowCriar] = useState(false);
  const [editando, setEditando]   = useState<UsuarioComReps | null>(null);
  const [acessoError, setAcessoError] = useState('');
  const [criarError, setCriarError] = useState('');
  const [senhaError, setSenhaError] = useState('');
  const [senhaSucesso, setSenhaSucesso] = useState(false);

  const { data: usuarios = [], isLoading, error: usuariosError } = useQuery({
    queryKey: ['admin-usuarios'],
    queryFn: fetchUsuarios,
  });

  const { data: todosReps = [] } = useQuery({
    queryKey: ['admin-representantes'],
    queryFn: fetchRepresentantes,
  });

  const criarMutation = useMutation({
    mutationFn: async ({ nome, email, senha, perfil, grupoIds }: { nome: string; email: string; senha: string; perfil: Perfil; grupoIds: string[] }) => {
      const result = await createUsuarioCompleto(nome, email, senha, perfil, grupoIds);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-usuarios'] }); setShowCriar(false); setCriarError(''); },
    onError: (err: Error) => setCriarError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, nome, perfil, grupoIds }: { id: string; nome: string; perfil: Perfil; grupoIds: string[] }) =>
      saveUsuarioAcesso(id, nome, perfil, grupoIds),
    onMutate: () => setAcessoError(''),
    // Os vinculos com representante ja sao gravados no clique do checkbox;
    // aqui fechamos o modal para o Salvar ter um desfecho visivel.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-usuarios'] });
      setEditando(null);
    },
    onError: (err: Error) => setAcessoError(err.message),
  });

  const toggleAtivoMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => updateUsuario(id, { ativo: !ativo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-usuarios'] }),
  });

  const linkMutation = useMutation({
    mutationFn: ({ usuarioId, repId }: { usuarioId: string; repId: string }) => linkRepresentante(usuarioId, repId),
    onMutate: () => setAcessoError(''),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-usuarios'] }),
    onError: (err: Error) => setAcessoError(`Falha ao vincular o representante: ${err.message}`),
  });

  const unlinkMutation = useMutation({
    mutationFn: ({ usuarioId, repId }: { usuarioId: string; repId: string }) => unlinkRepresentante(usuarioId, repId),
    onMutate: () => setAcessoError(''),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-usuarios'] }),
    onError: (err: Error) => setAcessoError(`Falha ao desvincular o representante: ${err.message}`),
  });

  const senhaMutation = useMutation({
    mutationFn: ({ id, novaSenha }: { id: string; novaSenha: string }) => updateSenha(id, novaSenha),
    onMutate: () => { setSenhaError(''); setSenhaSucesso(false); },
    onSuccess: () => { setSenhaError(''); setSenhaSucesso(true); },
    onError: (err: Error) => { setSenhaError(err.message); setSenhaSucesso(false); },
  });

  const usuarioEditandoAtualizado = editando
    ? usuarios.find(u => u.id === editando.id) ?? editando
    : null;

  return (
    <PageContainer size="lg">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Usuários</h1>
          <p className="text-sm text-gray-500 mt-0.5">Representantes, operadores e administradores do portal</p>
        </div>
        <button
          onClick={() => { setCriarError(''); setShowCriar(true); }}
          className="flex items-center gap-1.5 h-9 px-4 bg-[hsl(142,93%,8%)] text-white text-sm rounded-lg hover:bg-[hsl(142,93%,15%)] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Adicionar
        </button>
      </div>

      {usuariosError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          <strong>Erro ao carregar usuários:</strong> {(usuariosError as Error).message}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-[hsl(142,93%,8%)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : usuarios.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-12">Nenhum usuário cadastrado</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {usuarios.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 transition-colors">
                  <div className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0',
                    u.admin ? 'bg-amber-500' : u.operador ? 'bg-sky-500' : 'bg-[hsl(142,93%,8%)]'
                  )}>
                    {u.nome.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900">{u.nome}</span>
                      <TipoBadge u={u} />
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                        u.ativo ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      )}>
                        {u.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{u.email}</p>
                    {!u.admin && !u.operador && u.reps.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {u.reps.map(r => (
                          <span key={r.id} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                            {r.codigo}
                          </span>
                        ))}
                      </div>
                    )}
                    {!u.admin && !u.operador && u.reps.length === 0 && (
                      <p className="text-[10px] text-amber-600 mt-0.5">Sem representantes vinculados</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggleAtivoMutation.mutate({ id: u.id, ativo: u.ativo })}
                      title={u.ativo ? 'Desativar' : 'Ativar'}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                      {u.ativo ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setEditando(u)} title="Editar"
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showCriar && (
        <CriarModal
          onClose={() => setShowCriar(false)}
          onSave={(nome, email, senha, perfil, grupoIds) => criarMutation.mutate({ nome, email, senha, perfil, grupoIds })}
          saving={criarMutation.isPending}
          error={criarError}
        />
      )}

      {usuarioEditandoAtualizado && (
        <EditarModal
          usuario={usuarioEditandoAtualizado}
          todosReps={todosReps}
          onClose={() => { setEditando(null); setSenhaError(''); setSenhaSucesso(false); setAcessoError(''); }}
          saving={updateMutation.isPending}
          onUpdate={(nome, perfil, grupoIds) => updateMutation.mutate({ id: usuarioEditandoAtualizado.id, nome, perfil, grupoIds })}
          onLink={repId => linkMutation.mutate({ usuarioId: usuarioEditandoAtualizado.id, repId })}
          onUnlink={repId => unlinkMutation.mutate({ usuarioId: usuarioEditandoAtualizado.id, repId })}
          onAlterarSenha={novaSenha => senhaMutation.mutate({ id: usuarioEditandoAtualizado.id, novaSenha })}
          savingSenha={senhaMutation.isPending}
          senhaError={senhaError}
          senhaSucesso={senhaSucesso}
          acessoError={acessoError}
        />
      )}
    </PageContainer>
  );
}
