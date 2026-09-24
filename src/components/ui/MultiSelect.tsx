import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { SelectOption } from './Select';

// ─────────────────────────────────────────────────────────────────────────────
// Select de múltipla escolha. Mesma identidade visual do Select de escolha
// única, mas construído sobre DropdownMenu: o Select do Radix é single-value
// por contrato e não tem modo múltiplo.
//
// O menu NÃO fecha ao marcar um item (`onSelect` com preventDefault) — sem isso
// escolher três meses exigiria abrir o menu três vezes.
// ─────────────────────────────────────────────────────────────────────────────

export default function MultiSelect({
  values,
  onChange,
  options,
  placeholder = 'Todos',
  /** Rótulo quando há seleção: recebe as opções marcadas, na ordem da lista. */
  resumo,
  disabled,
  className,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  resumo?: (selecionadas: SelectOption[]) => string;
  disabled?: boolean;
  className?: string;
}) {
  const marcadas = options.filter(o => values.includes(o.value));
  const isActive = marcadas.length > 0;

  const texto = !isActive
    ? placeholder
    : resumo
      ? resumo(marcadas)
      : marcadas.map(o => o.label).join(', ');

  function alterna(value: string) {
    onChange(
      values.includes(value)
        ? values.filter(v => v !== value)
        // Mantém a ordem da lista de opções, não a ordem dos cliques: assim o
        // rótulo lê "Jan, Mar, Set" e não "Set, Jan, Mar".
        : options.filter(o => o.value === value || values.includes(o.value)).map(o => o.value),
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-between rounded-lg border outline-none overflow-hidden transition-colors',
          'h-10 sm:h-9 w-full px-3 text-sm gap-2',
          'focus:ring-2 focus:ring-[hsl(142,93%,8%)] focus:border-transparent',
          'data-[state=open]:ring-2 data-[state=open]:ring-[hsl(142,93%,8%)] data-[state=open]:border-transparent',
          'border-gray-300 bg-white disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400',
          isActive ? 'text-gray-900' : 'text-gray-400',
          className,
        )}
      >
        <span className="min-w-0 truncate text-left flex-1" title={isActive ? marcadas.map(o => o.label).join(', ') : undefined}>
          {texto}
        </span>
        <ChevronDown className="w-4 h-4 flex-shrink-0 text-gray-400" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className={cn(
            'radix-pop z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg',
            'min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[min(20rem,var(--radix-popper-available-width))]',
          )}
        >
          <div className="p-1 scrollbar-thin overflow-y-auto max-h-[min(16rem,var(--radix-dropdown-menu-content-available-height))]">
            <DropdownMenu.Item
              onSelect={e => { e.preventDefault(); onChange([]); }}
              className={cn(
                'relative flex items-center pl-3 pr-8 py-2 text-sm rounded-lg cursor-pointer select-none outline-none',
                'text-gray-700 data-[highlighted]:bg-gray-50 data-[highlighted]:text-gray-900',
                !isActive && 'text-[hsl(142,93%,8%)] font-medium',
              )}
            >
              {placeholder}
              {!isActive && <Check className="w-4 h-4 absolute right-2" />}
            </DropdownMenu.Item>

            {options.map(o => (
              <DropdownMenu.CheckboxItem
                key={o.value}
                checked={values.includes(o.value)}
                // preventDefault mantém o menu aberto para marcar vários.
                onSelect={e => e.preventDefault()}
                onCheckedChange={() => alterna(o.value)}
                className={cn(
                  'relative flex items-center pl-3 pr-8 py-2 text-sm rounded-lg cursor-pointer select-none outline-none',
                  'text-gray-700 data-[highlighted]:bg-gray-50 data-[highlighted]:text-gray-900',
                  'data-[state=checked]:text-[hsl(142,93%,8%)] data-[state=checked]:font-medium',
                )}
              >
                {o.label}
                <DropdownMenu.ItemIndicator className="absolute right-2 inline-flex items-center">
                  <Check className="w-4 h-4" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.CheckboxItem>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
