import { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { FileDown, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { fetchOrcamentoById } from '@/services/orcamentos';
import { OrcamentoPDFDocument } from './OrcamentoPDF';

interface Props {
  orcamentoId: string;
  numero: string;
  variant?: 'button' | 'icon';
  className?: string;
}

// Gera e baixa o PDF do orçamento. Reutilizável fora do botão (ex.: menu de ações ⋮).
export async function baixarOrcamentoPDF(orcamentoId: string, numero: string) {
  try {
    const orc = await fetchOrcamentoById(orcamentoId);
    const blob = await pdf(<OrcamentoPDFDocument orcamento={orc} />).toBlob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${numero}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    alert('Não foi possível gerar o PDF do orçamento. Tente novamente ou avise o suporte.');
  }
}

export default function OrcamentoPDFButton({ orcamentoId, numero, variant = 'button', className }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    if (loading) return;
    setLoading(true);
    try {
      await baixarOrcamentoPDF(orcamentoId, numero);
    } finally {
      setLoading(false);
    }
  }

  if (variant === 'icon') {
    return (
      <button
        onClick={handleDownload}
        disabled={loading}
        title="Baixar PDF"
        className={cn(
          'p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50',
          className
        )}
      >
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <FileDown className="w-4 h-4" />
        }
      </button>
    );
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className={cn(
        'h-7 px-2.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1 disabled:opacity-50',
        className
      )}
    >
      {loading
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <FileDown className="w-3 h-3" />
      }
      {loading ? 'Gerando...' : 'PDF'}
    </button>
  );
}
