"use client";

import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEditLead } from "@/hooks/kanban/useUpdateLead";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import type { Lead } from "@/lib/types/leads";
import { updateLeadSchema, type UpdateLeadInput } from "@/lib/schemas/leads";
import { MOEDA_PADRAO, parseReaisToCents, simboloDaMoeda } from "@/lib/money";
import { soChavesAlteradas } from "@/lib/leads/custom-fields-so-diff";
import { CustomFieldsEditor, type CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";
import { EcoDoValor } from "./EcoDoValor";

interface FormShape {
  title: string;
  description: string;
  valueReais: string;
  tagsRaw: string;
  expected_close_date: string;
  /** "", "recorrente" ou "avulso" — vazio é NÃO classificado, e é legítimo. */
  revenue_kind: string;
  /** Meses de contrato, como texto (o input devolve string). */
  recurring_months: string;
  /** user_id de quem ORIGINOU a venda. "" = ninguém, e é o caso comum. */
  originated_by_user_id: string;
}

interface Props {
  lead: Lead;
  pipelineId: string;
  fieldDefs?: CustomFieldDef[];
  /** Quando o salvamento dá certo. O dossiê NÃO fecha aqui — ver abaixo. */
  onSaved?: () => void;
  /** O dossiê não tem "cancelar"; o diálogo tem. */
  onCancel?: () => void;
  /**
   * FORK MIA: a pessoa enxerga a equipe (`usePodeVerEquipe`)? Decide se o
   * seletor de "quem originou" lista os membros.
   *
   * Vem de quem monta o formulário (dossiê e diálogo), e não de um
   * `usePermission` aqui dentro: este componente é do upstream, e os testes
   * dele simulam `@/hooks/auth/AuthProvider` só com `useActiveOrg`. Um
   * `usePermission` do fork aqui dentro derrubava a montagem inteira nesses
   * testes. Ausente = não enxerga, que é o lado seguro: sem a lista, o valor
   * gravado continua aparecendo pela opção de reserva.
   */
  podeVerEquipe?: boolean;
}

function centsToReais(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Os campos do lead — extraídos do `EditLeadDialog` para o dossiê usar os
 * MESMOS, em vez de uma cópia que diverge no mês.
 *
 * `onSaved` existe para o dossiê NÃO FECHAR ao salvar: quem edita precisa ver a
 * atividade que acabou de gerar entrar na timeline. Fechar esconderia o
 * registro justamente de quem o produziu — a funcionalidade que prova "sua ação
 * fica registrada" provaria isso para todo mundo menos para o autor.
 */
export function LeadFieldsForm({
  lead,
  pipelineId,
  fieldDefs = [],
  onSaved,
  onCancel,
  podeVerEquipe = false,
}: Props) {
  const t = useT();
  const org = useActiveOrg();
  // A moeda do negócio JÁ GRAVADO vence: trocar a moeda da empresa não
  // reescreve o que nasceu antes, e o cartão e o dossiê mostram a persistida.
  const moedaDoValor = lead.currency ?? org?.currency ?? MOEDA_PADRAO;
  const edit = useEditLead(pipelineId);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(lead.custom_fields ?? {});
  // Mesmo picker da reatribuição (spec 13 §4: escrita no funil é agent+): um
  // viewer não veria a lista, e a rota também a negaria. A permissão chega por
  // `podeVerEquipe` (ver a prop).
  const { data: membros } = useAssignableMembers(podeVerEquipe);
  /**
   * Quem originou pode já ter saído do time — a lista só traz membro ATIVO.
   * Sem esta checagem o select abriria vazio e o salvamento apagaria, calado, a
   * origem de uma venda já fechada.
   */
  const origemForaDaLista =
    !!lead.originated_by_user_id &&
    !(membros ?? []).some((m) => m.user_id === lead.originated_by_user_id);
  // A RÉGUA do diff (issue #2132): o valor carregado ao abrir. Só o que a
  // pessoa mudar daqui vai viajar — devolver o objeto inteiro sobrescrevia o
  // que outra pessoa (ou o MCP `crm_update_lead`) mudou com a ficha aberta.
  const [camposCarregados, setCamposCarregados] = useState<Record<string, unknown>>(
    lead.custom_fields ?? {},
  );

  const form = useForm<FormShape>({
    defaultValues: {
      title: lead.title,
      description: lead.description ?? "",
      valueReais: centsToReais(lead.value_cents),
      revenue_kind: lead.revenue_kind ?? "",
      recurring_months: lead.recurring_months ? String(lead.recurring_months) : "",
      originated_by_user_id: lead.originated_by_user_id ?? "",
      tagsRaw: (lead.tags ?? []).join(", "),
      expected_close_date: lead.expected_close_date ?? "",
    },
  });

  /**
   * `useWatch` e não `form.watch()` no render: o segundo devolve uma função
   * que o React Compiler não consegue memoizar, e ele desiste de otimizar o
   * formulário inteiro (mesmo motivo documentado no EcoDoValor).
   */
  const tipoDeReceita = useWatch({ control: form.control, name: "revenue_kind" });

  useEffect(() => {
    form.reset({
      title: lead.title,
      description: lead.description ?? "",
      valueReais: centsToReais(lead.value_cents),
      revenue_kind: lead.revenue_kind ?? "",
      recurring_months: lead.recurring_months ? String(lead.recurring_months) : "",
      originated_by_user_id: lead.originated_by_user_id ?? "",
      tagsRaw: (lead.tags ?? []).join(", "),
      expected_close_date: lead.expected_close_date ?? "",
    });
    setCustomFields(lead.custom_fields ?? {});
    setCamposCarregados(lead.custom_fields ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  async function onSubmit(values: FormShape) {
    const tags = values.tagsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const reais = values.valueReais.trim();
    let valueCents: number | null = null;
    if (reais.length > 0) {
      valueCents = parseReaisToCents(reais);
      if (valueCents === null) {
        form.setError("valueReais", { message: t("Valor inválido") });
        return;
      }
    }

    const patch: Record<string, unknown> = {
      title: values.title.trim(),
      description: values.description.trim() ? values.description.trim() : null,
      value_cents: valueCents,
      tags,
      expected_close_date: values.expected_close_date || null,
      // Vazio volta a NULO de propósito: "não classificado" é um estado, e não
      // a ausência de uma escolha que o sistema deveria ter chutado.
      revenue_kind: values.revenue_kind ? values.revenue_kind : null,
      recurring_months:
        values.revenue_kind === "recorrente" && values.recurring_months
          ? Number(values.recurring_months)
          : null,
      // Vazio volta a NULO: "não teve SDR" é resposta, e é a mais frequente
      // quando quem prospecta é quem fecha.
      originated_by_user_id: values.originated_by_user_id ? values.originated_by_user_id : null,
      // Só o que a pessoa alterou (issue #2132) — o merge continua do servidor.
      ...(fieldDefs.length > 0
        ? { custom_fields: soChavesAlteradas(camposCarregados, customFields) }
        : {}),
    };

    const parsed = updateLeadSchema.safeParse(patch);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? t("Dados inválidos"));
      return;
    }

    try {
      await edit.mutateAsync({
        leadId: lead.id,
        patch: parsed.data as UpdateLeadInput,
      });
      // O que acabou de gravar vira a nova régua: o segundo salvamento não
      // reenvia o primeiro, e uma limpeza alheia no intervalo não é atropelada.
      setCamposCarregados({ ...customFields });
      toast.success(t("Lead atualizado"));
      onSaved?.();
    } catch {
      // toast already shown
    }
  }


  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">{t("Título")}</Label>
          <Input
            id="title"
            {...form.register("title", { required: true, minLength: 2 })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">{t("Descrição")}</Label>
          <Textarea id="description" rows={3} {...form.register("description")} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            {/* O rótulo segue a moeda do NEGÓCIO (a organização é a reserva):
                  `R$` em duro mentia para quem opera em euro. */}
            <Label htmlFor="valueReais">{t("Valor")} ({simboloDaMoeda(moedaDoValor)})</Label>
            <Input
              id="valueReais"
              inputMode="decimal"
              placeholder="0,00"
              {...form.register("valueReais")}
            />
            <EcoDoValor control={form.control} moeda={moedaDoValor} />
            {form.formState.errors.valueReais && (
              <p className="text-xs text-error-fg">
                {t(form.formState.errors.valueReais.message ?? "")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="expected_close_date">{t("Fechamento previsto")}</Label>
            <Input
              id="expected_close_date"
              type="date"
              {...form.register("expected_close_date")}
            />
          </div>
        </div>

        {/* A natureza da receita é o que separa mensalidade de projeto no
            relatório do mês. Vazio continua sendo uma resposta: a tela de metas
            mostra quantas vendas ficaram sem classificar, em vez de somá-las
            para um lado e inventar a divisão. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="revenue_kind">{t("Tipo de receita")}</Label>
            <select
              id="revenue_kind"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              {...form.register("revenue_kind")}
            >
              <option value="">{t("Não classificado")}</option>
              <option value="recorrente">{t("Recorrente (mensalidade)")}</option>
              <option value="avulso">{t("Avulso (projeto, setup)")}</option>
            </select>
          </div>
          {tipoDeReceita === "recorrente" ? (
            <div className="space-y-2">
              <Label htmlFor="recurring_months">{t("Meses de contrato")}</Label>
              <Input
                id="recurring_months"
                inputMode="numeric"
                placeholder="12"
                {...form.register("recurring_months")}
              />
            </div>
          ) : null}
        </div>

        {/* Quem ORIGINOU: o SDR que marcou a reunião, quando não é quem
            fecha. A participação dele na meta sai daqui — do mesmo lugar em
            que a venda é registrada — e não de uma planilha no fim do mês. */}
        <div className="space-y-2">
          <Label htmlFor="originated_by_user_id">{t("Originado por (SDR)")}</Label>
          <select
            id="originated_by_user_id"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            {...form.register("originated_by_user_id")}
          >
            <option value="">{t("Ninguém")}</option>
            {(membros ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name ?? t("Sem nome")}
              </option>
            ))}
            {origemForaDaLista && (
              <option value={lead.originated_by_user_id ?? ""}>
                {t("Fora da equipe atual")}
              </option>
            )}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tagsRaw">{t("Tags (separadas por vírgula)")}</Label>
          <Input id="tagsRaw" placeholder="vip, recompra" {...form.register("tagsRaw")} />
        </div>

        {fieldDefs.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">{t("Campos do funil")}</p>
            <CustomFieldsEditor
              fields={fieldDefs}
              value={customFields}
              onChange={setCustomFields}
              mode="lead"
            />
          </div>
        )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={edit.isPending}>
            {t("Cancelar")}
          </Button>
        )}
        <Button type="submit" disabled={edit.isPending}>
          {edit.isPending ? t("Salvando…") : t("Salvar")}
        </Button>
      </div>
    </form>
  );
}
