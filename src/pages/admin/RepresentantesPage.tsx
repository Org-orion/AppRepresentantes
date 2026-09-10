import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X, ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import PageContainer from '@/components/ui/PageContainer';
import { cn } from '@/utils/cn';
import type { RepresentanteERP } from '@/types';
import {
  fetchRepresentantes,
  createRepresentante,
  updateRepresentante,
  deleteRepresentante,
} from '@/services/representantes';

// ─── Formulário vazio ──────────────────────────────────
const EMPTY_FORM = {
  codigo: '',
  nome_erp: '',
  representante_erp: '',
  comissao_percentual: 0,
};

type FormData = typeof EMPTY_FORM;

// ─── Modal de criação / edição ─────────────────────────
function RepModal({
  initial,
  onClose,
  onSave,
  saving,
  erro,
}: {
  initial: FormData & { id?: string };
  onClose: () => void;
  onSave: (data: FormData & { id?: string }) => void;
  saving: boolean;
  erro?: string;
}) {
  const [form, setForm] = useState(initial);

  function set(field: keyof FormData, value: string | number) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  // Autopreenchimento do representante_erp
  function handleCodigoOrNome() {
    if (form.codigo && form.nome_erp && !form.id) {
      setForm(prev => ({
        ...prev,
        representante_erp: `${prev.codigo.trim()} - ${prev.nome_erp.trim()}`,
      }));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{form.id ? 'Editar' : 'Novo'} Representante ERP</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Código ERP</label>
              <input
                value={form.codigo}
                onChange={e => set('codigo', e.target.value)}
                onBlur={handleCodigoOrNome}
                placeholder="40054603"
                className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Comissão (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.comissao_percentual}
                onChange={e => set('comissao_percentual', parseFloat(e.target.value) || 0)}
                className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Nome no ERP</label>
            <input
              value={form.nome_erp}
              onChange={e => set('nome_erp', e.target.value)}
              onBlur={handleCodigoOrNome}
              placeholder="DISTRIBUIDORA / MKT LILLIAN 15"
              className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">
              Representante ERP
              <span className="ml-1 text-gray-400 font-normal">(campo exato da tabela de pedidos)</span>
            </label>
            <input
              value={form.representante_erp}
              onChange={e => set('representante_erp', e.target.value)}
              placeholder="40054603 - DISTRIBUIDORA / MKT LILLIAN 15"
              className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)] font-mono text-xs"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Deve ser idêntico ao valor em <code>concrem_pedidos_venda.representante</code>
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-5 py-4 border-t border-gray-100">
          {erro && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {erro}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 px-4 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.codigo || !form.nome_erp || !form.representante_erp}
            className="h-9 px-4 text-sm bg-[hsl(142,93%,8%)] text-white rounded-lg hover:bg-[hsl(142,93%,15%)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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

// ─── Página ────────────────────────────────────────────
export default function AdminRepresentantesPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<(FormData & { id?: string }) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RepresentanteERP | null>(null);
  const [saveErro, setSaveErro] = useState('');

  const { data: reps = [], isLoading, error: repsError } = useQuery({
    queryKey: ['admin-representantes'],
    queryFn: fetchRepresentantes,
  });

  const saveMutation = useMutation({
    mutationFn: async (form: FormData & { id?: string }) => {
      const { id, ...payload } = form;
      if (id) {
        await updateRepresentante(id, payload);
      } else {
        await createRepresentante(payload);
      }
    },
    onMutate: () => setSaveErro(''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-representantes'] });
      setModal(null);
    },
    // O banco exige que `representante_erp` comece pelo `codigo`
    // (rep_codigo_prefixo_chk): o escopo do representante deriva desse campo.
    onError: (err: Error) => setSaveErro(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      updateRepresentante(id, { ativo: !ativo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-representantes'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRepresentante(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-representantes'] });
      setConfirmDelete(null);
    },
  });

  const deleteErro = deleteMutation.error
    ? deleteMutation.error instanceof Error
      ? deleteMutation.error.message
      : 'Falha ao excluir o representante.'
    : null;

  return (
    <PageContainer size="lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Representantes ERP</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Códigos vinculados a usuários para filtrar pedidos
          </p>
        </div>
        <button
          onClick={() => setModal({ ...EMPTY_FORM })}
          className="flex items-center gap-1.5 h-9 px-3 sm:px-4 bg-[hsl(142,93%,8%)] text-white text-sm rounded-lg hover:bg-[hsl(142,93%,15%)] transition-colors"
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          <span className="hidden sm:inline">Adicionar</span>
        </button>
      </div>

      {repsError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          <strong>Erro ao carregar representantes:</strong> {(repsError as Error).message}
        </div>
      )}

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-[hsl(142,93%,8%)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : reps.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-12">Nenhum representante cadastrado</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {reps.map(rep => (
                <div key={rep.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 transition-colors">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                        {rep.codigo}
                      </span>
                      <span className="font-semibold text-sm text-gray-900">{rep.nome_erp}</span>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                        rep.ativo ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      )}>
                        {rep.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">{rep.representante_erp}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Comissão: <strong>{rep.comissao_percentual}%</strong></p>
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleMutation.mutate({ id: rep.id, ativo: rep.ativo })}
                      title={rep.ativo ? 'Desativar' : 'Ativar'}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {rep.ativo
                        ? <ToggleRight className="w-4 h-4 text-green-600" />
                        : <ToggleLeft className="w-4 h-4" />
                      }
                    </button>
                    <button
                      onClick={() => setModal({ ...EMPTY_FORM, ...rep })}
                      title="Editar"
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(rep)}
                      title="Excluir"
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal criar/editar */}
      {modal && (
        <RepModal
          initial={modal}
          onClose={() => { setModal(null); setSaveErro(''); }}
          onSave={form => saveMutation.mutate(form)}
          saving={saveMutation.isPending}
          erro={saveErro}
        />
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-2">Confirmar exclusão</h3>
            <p className="text-sm text-gray-600 mb-1">
              Tem certeza que deseja excluir o representante:
            </p>
            <p className="text-sm font-semibold text-gray-900 mb-4">{confirmDelete.nome_erp}</p>
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-4">
              Isso também removerá o vínculo com todos os usuários.
            </p>
            {deleteErro && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
                {deleteErro}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { deleteMutation.reset(); setConfirmDelete(null); }}
                className="h-9 px-4 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDelete.id)}
                disabled={deleteMutation.isPending}
                className="h-9 px-4 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
