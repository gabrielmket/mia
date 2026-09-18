"use client";

/**
 * "De qual empresa é isto?" — um seletor só, usado na ficha do contato e na do
 * negócio.
 *
 * Por que uma LISTA e não um campo de texto: texto digitado a cada cadastro
 * produz "Padaria do Zé", "Padaria do Ze" e "PADARIA DO ZÉ" como três clientes
 * diferentes, e aí nenhuma pergunta agregada ("quanto vendemos para eles")
 * funciona. A lista é o que garante que o vínculo aponte para a MESMA linha.
 *
 * O item "Sem empresa" existe e é o primeiro: desvincular é caso de uso — a
 * pessoa trocou de emprego —, não um erro a ser dificultado.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useEmpresas } from "@/hooks/useEmpresas";

/** `Select` do Radix não aceita valor vazio; este é o "nenhuma". */
const SEM_EMPRESA = "__sem_empresa__";

export function SeletorDeEmpresa({
  valor,
  aoMudar,
  id,
  desabilitado,
}: {
  valor: string | null;
  aoMudar: (empresaId: string | null) => void;
  id?: string;
  desabilitado?: boolean;
}) {
  const t = useT();
  const { data, isLoading } = useEmpresas("");
  const empresas = data?.data ?? [];

  /**
   * A empresa vinculada entra na lista mesmo se não vier na primeira página.
   *
   * Sem isto, um contato de uma empresa fora das 50 primeiras apareceria como
   * "Sem empresa" — a tela afirmando que o vínculo não existe quando ele
   * existe, e a primeira edição do contato o apagaria de verdade.
   */
  const faltaAVinculada = valor !== null && !empresas.some((e) => e.id === valor);

  return (
    <Select
      value={valor ?? SEM_EMPRESA}
      disabled={desabilitado || isLoading}
      onValueChange={(v) => aoMudar(v === SEM_EMPRESA ? null : v)}
    >
      <SelectTrigger id={id} aria-label={t("Empresa")}>
        <SelectValue placeholder={t("Sem empresa")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SEM_EMPRESA}>{t("Sem empresa")}</SelectItem>
        {faltaAVinculada && valor && (
          <SelectItem value={valor}>{t("Empresa vinculada")}</SelectItem>
        )}
        {empresas.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
