import { supabase } from '@/lib/supabase/client';
import type { RepresentanteERP } from '@/types';

export async function fetchRepresentantes(): Promise<RepresentanteERP[]> {
  const { data, error } = await supabase
    .from('concremapprep_representantes')
    .select('*')
    .order('representante_erp');
  if (error) throw error;
  return (data ?? []) as RepresentanteERP[];
}

export async function createRepresentante(
  rep: Pick<RepresentanteERP, 'codigo' | 'nome_erp' | 'representante_erp' | 'comissao_percentual'>
): Promise<RepresentanteERP> {
  const { data, error } = await supabase
    .from('concremapprep_representantes')
    .insert({ ...rep, ativo: true })
    .select()
    .single();
  if (error) throw error;
  return data as RepresentanteERP;
}

export async function updateRepresentante(
  id: string,
  rep: Partial<Pick<RepresentanteERP, 'codigo' | 'nome_erp' | 'representante_erp' | 'comissao_percentual' | 'ativo'>>
): Promise<void> {
  const { error } = await supabase
    .from('concremapprep_representantes')
    .update(rep)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteRepresentante(id: string): Promise<void> {
  // `.select()` é obrigatório aqui: um DELETE barrado pela RLS não retorna erro,
  // ele apenas não encontra linha para apagar e devolve sucesso com zero linhas.
  // Sem conferir o retorno, a exclusão falha em silêncio e a tela finge que deu certo.
  const { data, error } = await supabase
    .from('concremapprep_representantes')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      'Nenhuma linha foi excluída. A política de segurança do banco (RLS) recusou a operação: ' +
      'ela exige o flag `admin` marcado no seu usuário, que é diferente da coluna `perfil` usada pela tela.'
    );
  }
}
