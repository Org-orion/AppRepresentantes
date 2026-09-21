// ─────────────────────────────────────────────────────────────────────────────
// Casamento de cliente por termo de busca — nome, nome fantasia ou CNPJ.
//
// Existia repetido em quatro telas (Carteira, clientes do grupo, novo orçamento
// e edição de orçamento), e nas quatro com o MESMO defeito:
//
//   cnpj.replace(/\D/g, '').includes(termo.replace(/\D/g, ''))
//
// Ao digitar um nome, `termo.replace(/\D/g, '')` vira '' — e em JavaScript
// `'qualquer'.includes('')` é SEMPRE `true`. O predicado do CNPJ casava com
// todo mundo, o `||` curto-circuitava e a busca por nome devolvia a lista
// inteira: parecia que o campo não fazia nada.
//
// Aqui o CNPJ só é comparado quando o termo tem dígito.
// ─────────────────────────────────────────────────────────────────────────────

export function soDigitos(valor?: string | null): string {
  return (valor ?? '').replace(/\D/g, '');
}

export interface ClienteBuscavel {
  cliente_nome?: string | null;
  cliente_fantasia?: string | null;
  cliente_cnpj?: string | null;
}

/**
 * `true` quando o cliente casa com o termo. Termo vazio (ou só espaços) casa
 * com todos — quem decide se filtra é a tela.
 */
export function clienteCasaBusca(cliente: ClienteBuscavel, termo: string): boolean {
  const q = termo.trim().toLowerCase();
  if (q === '') return true;

  if ((cliente.cliente_nome ?? '').toLowerCase().includes(q)) return true;
  if ((cliente.cliente_fantasia ?? '').toLowerCase().includes(q)) return true;

  const digitos = soDigitos(q);
  if (digitos === '') return false;
  return soDigitos(cliente.cliente_cnpj).includes(digitos);
}
