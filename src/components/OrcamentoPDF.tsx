import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import type { Orcamento, OrcamentoItem } from '@/types';

// URL absoluta para o logo (funciona no pdf renderer)
import logoPng from '@/assets/logo-concrem-preta.png';

// ─── Estilos ───────────────────────────────────────────
const S = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#1a1a1a',
    paddingTop: 32,
    paddingBottom: 40,
    paddingHorizontal: 36,
    backgroundColor: '#ffffff',
  },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  logo:   { width: 120, height: 32, objectFit: 'contain' },
  headerRight: { alignItems: 'flex-end' },
  docTitle: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#0D2012', letterSpacing: 1 },
  docNum:   { fontSize: 10, color: '#555', marginTop: 2 },
  docDate:  { fontSize: 8, color: '#888', marginTop: 2 },

  divider: { borderBottomWidth: 1.5, borderBottomColor: '#0D2012', marginBottom: 12 },
  dividerLight: { borderBottomWidth: 0.5, borderBottomColor: '#ddd', marginVertical: 8 },

  // Seções de info
  twoCol: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  infoBox: { flex: 1, backgroundColor: '#f8f9fa', borderRadius: 4, padding: 8, borderLeftWidth: 2.5, borderLeftColor: '#0D2012' },
  infoBoxLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  infoValue: { fontSize: 9, color: '#1a1a1a', marginBottom: 2 },
  infoValueBold: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#1a1a1a', marginBottom: 2 },
  infoSmall: { fontSize: 8, color: '#666', marginBottom: 1 },

  // Condições (linha única)
  condRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  condItem: { flex: 1, backgroundColor: '#f0f4f0', borderRadius: 4, padding: 6, alignItems: 'center' },
  condLabel: { fontSize: 7, color: '#666', fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  condValue: { fontSize: 8.5, color: '#0D2012', fontFamily: 'Helvetica-Bold' },

  // Tabela de itens
  tableHeader: { flexDirection: 'row', backgroundColor: '#0D2012', borderRadius: 3, paddingVertical: 5, paddingHorizontal: 4, marginBottom: 1 },
  tableRow:    { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 0.4, borderBottomColor: '#e5e7eb' },
  tableRowAlt: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, backgroundColor: '#f9fafb', borderBottomWidth: 0.4, borderBottomColor: '#e5e7eb' },
  thText: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  tdText: { fontSize: 8, color: '#1a1a1a' },
  tdMuted: { fontSize: 8, color: '#666' },

  // Colunas da tabela
  colNum:   { width: 20  },
  colCod:   { width: 60  },
  colDesc:  { flex: 1    },
  colUn:    { width: 24  },
  colQtd:   { width: 32, textAlign: 'right' },
  colVun:   { width: 52, textAlign: 'right' },
  colTotal: { width: 60, textAlign: 'right' },

  // Totais
  totaisBox: { marginTop: 8, alignItems: 'flex-end' },
  totalRow:  { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 2 },
  totalLabel: { fontSize: 8.5, color: '#555', width: 100, textAlign: 'right' },
  totalValue: { fontSize: 8.5, color: '#1a1a1a', width: 80, textAlign: 'right' },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#0D2012' },
  grandTotalLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#0D2012', width: 100, textAlign: 'right' },
  grandTotalValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#0D2012', width: 80, textAlign: 'right' },

  // Observações
  obsBox: { marginTop: 10, backgroundColor: '#fffbeb', borderRadius: 4, padding: 8, borderLeftWidth: 2.5, borderLeftColor: '#f59e0b' },
  obsLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 },
  obsText:  { fontSize: 8, color: '#78350f', lineHeight: 1.5 },

  // Rodapé
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerText: { fontSize: 7, color: '#aaa' },
  footerBrand: { fontSize: 7, color: '#0D2012', fontFamily: 'Helvetica-Bold' },

  // Alerta rejeição
  rejectBox: { backgroundColor: '#fef2f2', borderRadius: 4, padding: 8, borderLeftWidth: 2.5, borderLeftColor: '#ef4444', marginBottom: 10 },
  rejectLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 },
  rejectText: { fontSize: 8, color: '#991b1b' },
});

// ─── Helpers ───────────────────────────────────────────
function fmt(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d);
}

// ─── Documento ─────────────────────────────────────────
interface Props {
  orcamento: Orcamento & { itens: OrcamentoItem[] };
}

export function OrcamentoPDFDocument({ orcamento: orc }: Props) {
  const nomeCliente = orc.cliente_fantasia?.trim() || orc.cliente_nome;
  const itens = orc.itens ?? [];

  const subtotal = itens.reduce((s, i) => s + (i.preco_unitario ?? 0) * i.quantidade, 0);
  const frete    = orc.frete_valor ?? 0;
  const total    = subtotal + frete;

  const freteLabel = orc.frete_tipo
    ? `Frete (${orc.frete_tipo.toUpperCase()})`
    : 'Frete';

  const hoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());

  return (
    <Document title={`Orçamento ${orc.numero}`} author="Concrem" subject="Orçamento Comercial">
      <Page size="A4" orientation="landscape" style={S.page}>

        {/* ── HEADER ── */}
        <View style={S.header}>
          <Image src={logoPng} style={S.logo} />
          <View style={S.headerRight}>
            <Text style={S.docTitle}>ORÇAMENTO</Text>
            <Text style={S.docNum}>{orc.numero}</Text>
            <Text style={S.docDate}>Emitido em {hoje}</Text>
          </View>
        </View>

        <View style={S.divider} />

        {/* ── REJEIÇÃO (se aplicável) ── */}
        {orc.status === 'rejeitado' && orc.observacoes && (
          <View style={S.rejectBox}>
            <Text style={S.rejectLabel}>Orçamento Rejeitado — Motivo</Text>
            <Text style={S.rejectText}>{orc.observacoes}</Text>
          </View>
        )}

        {/* ── CLIENTE / REPRESENTANTE ── */}
        <View style={S.twoCol}>
          <View style={S.infoBox}>
            <Text style={S.infoBoxLabel}>Cliente</Text>
            <Text style={S.infoValueBold}>{nomeCliente}</Text>
            {orc.cliente_fantasia && orc.cliente_nome !== nomeCliente && (
              <Text style={S.infoSmall}>{orc.cliente_nome}</Text>
            )}
            <Text style={S.infoSmall}>CNPJ: {orc.cliente_cnpj}</Text>
            {orc.obra_referencia && (
              <Text style={S.infoSmall}>Obra: {orc.obra_referencia}</Text>
            )}
            {orc.endereco_entrega && (
              <Text style={S.infoSmall}>Entrega: {orc.endereco_entrega}</Text>
            )}
          </View>

          <View style={S.infoBox}>
            <Text style={S.infoBoxLabel}>Representante</Text>
            {orc.representante_erp ? (
              <Text style={S.infoValueBold}>{orc.representante_erp}</Text>
            ) : (
              <Text style={S.infoSmall}>Não informado</Text>
            )}
          </View>
        </View>

        {/* ── CONDIÇÕES ── */}
        <View style={S.condRow}>
          <View style={S.condItem}>
            <Text style={S.condLabel}>Emissão</Text>
            <Text style={S.condValue}>{fmtDate(orc.created_at)}</Text>
          </View>
          <View style={S.condItem}>
            <Text style={S.condLabel}>Validade</Text>
            <Text style={S.condValue}>{fmtDate(orc.validade)}</Text>
          </View>
          <View style={[S.condItem, { flex: 2 }]}>
            <Text style={S.condLabel}>Condição de Pagamento</Text>
            <Text style={S.condValue}>{orc.condicao_pagamento || '—'}</Text>
          </View>
          <View style={S.condItem}>
            <Text style={S.condLabel}>Tipo de Frete</Text>
            <Text style={S.condValue}>{orc.frete_tipo?.toUpperCase() || '—'}</Text>
          </View>
        </View>

        {/* ── TABELA DE ITENS ── */}
        <View style={S.tableHeader}>
          <Text style={[S.thText, S.colNum]}>#</Text>
          <Text style={[S.thText, S.colCod]}>Código</Text>
          <Text style={[S.thText, S.colDesc]}>Descrição</Text>
          <Text style={[S.thText, S.colUn]}>UN</Text>
          <Text style={[S.thText, S.colQtd]}>Qtd</Text>
          <Text style={[S.thText, S.colVun]}>Vlr Unit</Text>
          <Text style={[S.thText, S.colTotal]}>Total</Text>
        </View>

        {itens.length === 0 ? (
          <View style={[S.tableRow, { justifyContent: 'center' }]}>
            <Text style={S.tdMuted}>Nenhum item adicionado</Text>
          </View>
        ) : (
          itens.map((item, i) => {
            const rowStyle = i % 2 === 0 ? S.tableRow : S.tableRowAlt;
            const itemTotal = (item.preco_unitario ?? 0) * item.quantidade;
            return (
              <View key={item.id ?? i} style={rowStyle}>
                <Text style={[S.tdMuted, S.colNum]}>{i + 1}</Text>
                <Text style={[S.tdMuted, S.colCod]}>{item.produto_codigo}</Text>
                <Text style={[S.tdText, S.colDesc]}>{item.produto_descricao}</Text>
                <Text style={[S.tdMuted, S.colUn]}>{item.unidade}</Text>
                <Text style={[S.tdText, S.colQtd]}>{item.quantidade}</Text>
                <Text style={[S.tdText, S.colVun]}>
                  {item.preco_unitario ? fmt(item.preco_unitario) : '—'}
                </Text>
                <Text style={[S.tdText, S.colTotal]}>
                  {item.preco_unitario ? fmt(itemTotal) : '—'}
                </Text>
              </View>
            );
          })
        )}

        {/* ── TOTAIS ── */}
        <View style={S.totaisBox}>
          {subtotal > 0 && (
            <View style={S.totalRow}>
              <Text style={S.totalLabel}>Subtotal produtos</Text>
              <Text style={S.totalValue}>{fmt(subtotal)}</Text>
            </View>
          )}
          {frete > 0 && (
            <View style={S.totalRow}>
              <Text style={S.totalLabel}>{freteLabel}</Text>
              <Text style={S.totalValue}>{fmt(frete)}</Text>
            </View>
          )}
          <View style={S.grandTotalRow}>
            <Text style={S.grandTotalLabel}>TOTAL GERAL</Text>
            <Text style={S.grandTotalValue}>{fmt(total)}</Text>
          </View>
        </View>

        {/* ── OBSERVAÇÕES ── */}
        {orc.observacoes && orc.status !== 'rejeitado' && (
          <View style={S.obsBox}>
            <Text style={S.obsLabel}>Observações</Text>
            <Text style={S.obsText}>{orc.observacoes}</Text>
          </View>
        )}

        {/* ── RODAPÉ ── */}
        <View style={S.footer} fixed>
          <Text style={S.footerText}>
            Documento gerado em {hoje} · {orc.numero}
          </Text>
          <Text style={S.footerBrand}>Concrem Industria e Comercio Ltda</Text>
        </View>

      </Page>
    </Document>
  );
}
