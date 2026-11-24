"use client";

import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { roleAtLeast } from "@/lib/auth/types";
import { useT } from "@/hooks/i18n/useT";
import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEditLead } from "@/hooks/kanban/useUpdateLead";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import type { Lead } from "@/lib/types/leads";
import { updateLeadSchema, type UpdateLeadInput } from "@/lib/schemas/leads";
import { MOEDA_PADRAO, formatCents, parseReaisToCents, simboloDaMoeda } from "@/lib/money";
import { BotaoRegistrarVenda } from "@/components/vendas/BotaoRegistrarVenda";
import { useVendasDoNegocio } from "@/hooks/vendas/useVendasRegistradas";
import { soChavesAlteradas } from "@/lib/leads/custom-fields-so-diff";
import { CustomFieldsEditor, type CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";
import { ContactTagsEditor } from "@/components/inbox/ContactTagsEditor";
import { lerRecorrenciaDoFormulario } from "@/lib/leads/valor-recorrente";
import { EcoDoValor } from "./EcoDoValor";
import type { CampoConfirmadoDoDocumento } from "./RevisaoDoDocumento";
// FORK MIA (.109): o bloco de itens do negócio e o valor que soma
// (docs/fork/produto-no-negocio.md). O rascunho, o bloco e o campo moram no fork.
import { BlocoDeItens } from "@/components/produto-no-negocio/BlocoDeItens";
import { AvisoDoValorRecorrente, CampoDoValor } from "@/components/produto-no-negocio/CampoDoValor";
import { useRascunhoDoNegocio } from "@/components/produto-no-negocio/useRascunhoDoNegocio";
import { valorSegueAsVendas } from "@/lib/produto-no-negocio/regras";
import { usePalavraDoProduto, useProdutoNoFunil } from "@/hooks/produto-no-negocio/useProdutoNoNegocio";

/**
 * As etiquetas do negócio SAÍRAM deste formulário (#2979): quem as edita é o
 * `ContactTagsEditor`, que grava na hora em `crm_leads.tags`. Manter um
 * `tagsRaw` aqui seria pior do que redundância — "Salvar" reenviaria a lista
 * carregada na abertura do dossiê e DESFARIA em silêncio a etiqueta que a
 * pessoa acabou de criar no editor.
 */
interface FormShape {
  title: string;
  description: string;
  valueReais: string;
  /** Mensalidade e duração do contrato (fatia 1 da #3602), em texto. */
  valorRecorrenteReais: string;
  recorrenciaMeses: string;
  expected_close_date: string;
  /** "", "recorrente" ou "avulso" — vazio é NÃO classificado, e é legítimo. */
  revenue_kind: string;
  /** user_id de quem ORIGINOU a venda. "" = ninguém, e é o caso comum. */
  originated_by_user_id: string;
}

export interface ControleDosCamposDoNegocio {
  confirmarCampo: (confirmado: CampoConfirmadoDoDocumento) => void;
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
  /** Confirmação externa do próprio card: preserva os outros campos em edição. */
  controle?: Ref<ControleDosCamposDoNegocio>;
  /**
   * A DESCRIÇÃO ALTA (#4151): na página inteira do negócio ela é o campo que se
   * lê e se reescreve, e três linhas davam uma janela de 3,5 linhas de texto
   * para o único campo longo do formulário. Na gaveta de 28rem o padrão continua
   * sendo o de sempre — não é a mesma régua de espaço.
   */
  descricaoAlta?: boolean;
}

function centsToReais(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Duração em meses como texto (`null` = sem prazo, que é o campo vazio). */
function mesesComoTexto(meses: number | null | undefined): string {
  return meses === null || meses === undefined ? "" : String(meses);
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
  controle,
  descricaoAlta = false,
}: Props) {
  const t = useT();
  const org = useActiveOrg();
  // A moeda do negócio JÁ GRAVADO vence: trocar a moeda da empresa não
  // reescreve o que nasceu antes, e o cartão e o dossiê mostram a persistida.
  const moedaDoValor = lead.currency ?? org?.currency ?? MOEDA_PADRAO;
  const edit = useEditLead(pipelineId);
  // FORK MIA (.109): os itens do negócio e as opções do funil. O bloco assume o
  // Valor quando a leitura dos itens chega; até lá (e se ela falhar) vale o campo
  // Valor de antes: a ficha nunca fica sem como editar o valor.
  const funilDoProduto = useProdutoNoFunil(pipelineId).data;
  const palavra = usePalavraDoProduto(funilDoProduto?.palavra);
  const mostrarRecorrente = funilDoProduto?.mostrar_valor_recorrente ?? true;
  const itens = useRascunhoDoNegocio(lead.id, pipelineId);
  const usarBloco = itens.pronto;
  const [apagarRecorrente, setApagarRecorrente] = useState(false);
  const [blocoAssumiu, setBlocoAssumiu] = useState<string | null>(null);
  // Com venda registrada, o Valor É a soma das vendas na moeda do negócio —
  // o banco grava isso em `value_cents` (migration 9450). Aqui a soma sai da
  // mesma lista, para o campo acompanhar a venda recém-registrada sem esperar
  // o negócio ser relido.
  const { data: vendas } = useVendasDoNegocio(lead.id);
  const vendasDoNegocio = Array.isArray(vendas) ? vendas : [];
  // FORK MIA (fusão v1.124): com item no bloco, o valor continua sendo o dos
  // itens (ou o digitado à mão) e o banco desfaz a troca pela soma das vendas
  // (9167). O campo só vira "soma das vendas" quando o negócio não tem item.
  const valorPelasVendas = valorSegueAsVendas({ vendas: vendasDoNegocio.length, itens: itens.rascunho?.itens });
  const somaDasVendas = vendasDoNegocio.reduce(
    (soma, v) => soma + (v.currency.toUpperCase() === moedaDoValor.toUpperCase() ? v.valor_cents : 0),
    0,
  );
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(lead.custom_fields ?? {});
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
      originated_by_user_id: lead.originated_by_user_id ?? "",
      valorRecorrenteReais: centsToReais(lead.recurring_value_cents),
      recorrenciaMeses: mesesComoTexto(lead.recurring_months),
      expected_close_date: lead.expected_close_date ?? "",
    },
  });

  useEffect(() => {
    form.reset({
      title: lead.title,
      description: lead.description ?? "",
      valueReais: centsToReais(lead.value_cents),
      revenue_kind: lead.revenue_kind ?? "",
      originated_by_user_id: lead.originated_by_user_id ?? "",
      valorRecorrenteReais: centsToReais(lead.recurring_value_cents),
      recorrenciaMeses: mesesComoTexto(lead.recurring_months),
      expected_close_date: lead.expected_close_date ?? "",
    });
    setCustomFields(lead.custom_fields ?? {});
    setCamposCarregados(lead.custom_fields ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  // FORK MIA (.109): quem digitou no campo Valor de antes enquanto os itens
  // carregavam não perde o número: o bloco assume com o valor à mão digitado.
  if (itens.pronto && itens.rascunho && blocoAssumiu !== lead.id) {
    setBlocoAssumiu(lead.id);
    if (form.getFieldState("valueReais").isDirty) {
      itens.setRascunho({ ...itens.rascunho, modo: "a_mao", antigo: false, valorTexto: form.getValues("valueReais") });
    }
  }

  // O Valor relido do banco entra no campo quando a pessoa não o mexeu: apagar
  // a última venda devolve o valor digitado (decisão 2B do doc 396), e o campo
  // volta editável com ELE — não com a soma que estava em memória, que um
  // Salvar gravaria por cima.
  useEffect(() => {
    const doBanco = centsToReais(lead.value_cents);
    const carregado = form.formState.defaultValues?.valueReais;
    if (carregado === doBanco || form.getValues("valueReais") !== carregado) return;
    form.resetField("valueReais", { defaultValue: doBanco });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.value_cents]);

  useImperativeHandle(controle, () => ({
    confirmarCampo(confirmacao) {
      // A confirmação pode terminar depois de a pessoa abrir outro card.
      if (confirmacao.leadId !== lead.id) return;
      const { campo, valor } = confirmacao;
      // O evento já gravou este valor: atualiza o campo e a régua do diff,
      // preservando os outros rascunhos. Não remonta o formulário (#2132).
      setCustomFields((atuais) => ({ ...atuais, [campo]: valor }));
      setCamposCarregados((atuais) => ({ ...atuais, [campo]: valor }));
    },
  }), [lead.id]);

  async function onSubmit(values: FormShape) {
    // FORK MIA (.109): com o bloco, o valor é do rascunho (a soma ou o digitado) e
    // quem o grava é `PUT /api/v1/leads/[id]/itens`, antes do PATCH de sempre.
    if (usarBloco) {
      if (itens.valorAoSalvar === undefined) {
        toast.error(t("Corrija o valor antes de salvar."));
        return;
      }
    }
    const reais = values.valueReais.trim();
    let valueCents: number | null = null;
    if (!usarBloco && !valorPelasVendas && reais.length > 0) {
      // A MESMA moeda que o rótulo do campo mostra ao lado («Valor ($)»): é ela
      // que decide se a vírgula é decimal ou separador de milhar (#3331).
      valueCents = parseReaisToCents(reais, moedaDoValor);
      if (valueCents === null) {
        form.setError("valueReais", { message: t("Valor inválido") });
        return;
      }
    }

    // O RECORRENTE (fatia 1 da #3602) — a régua compartilhada com o diálogo de
    // criação e com o de edição; aqui também vai sempre, para apagar o campo
    // significar "não tem mais mensalidade".
    // Apagar a mensalidade de um negócio que a TINHA leva a duração junto: é a
    // regra 1 do trio, a mesma do servidor (`recorrenciaParaGravar`). Duração
    // digitada num negócio que nunca teve mensalidade segue sendo recusa.
    const apagouAMensalidade =
      lead.recurring_value_cents != null && values.valorRecorrenteReais.trim() === "";
    const leitura = lerRecorrenciaDoFormulario(
      values.valorRecorrenteReais,
      apagouAMensalidade ? "" : values.recorrenciaMeses,
      moedaDoValor,
    );
    // FORK MIA (.109): com o par escondido pelo funil, o que está gravado nele não
    // é validado (nem enviado): um negócio antigo com duração e sem mensalidade
    // não pode travar o Salvar de um campo que a pessoa nem vê.
    if (!leitura.ok && mostrarRecorrente) {
      form.setError(leitura.campo === "valor" ? "valorRecorrenteReais" : "recorrenciaMeses", {
        message:
          leitura.motivo === "valor_invalido"
            ? t("Valor inválido")
            : leitura.motivo === "duracao_invalida"
              ? t("Duração inválida")
              : t("Informe a mensalidade para usar a duração"),
      });
      return;
    }

    const patch: Record<string, unknown> = {
      title: values.title.trim(),
      description: values.description.trim() ? values.description.trim() : null,
      // FORK MIA (.109): com o bloco, o valor vai pelo PUT dos itens. Com venda
      // registrada (e sem item no bloco), o valor é do banco, a soma das vendas:
      // o formulário não o reescreve (regra do upstream, 9450).
      ...(usarBloco || valorPelasVendas ? {} : { value_cents: valueCents }),
      // FORK MIA (.109): com "Mostrar valor recorrente" desligado os campos não
      // aparecem e não viajam (o que está gravado fica), a não ser que a pessoa
      // tenha pedido "Apagar o valor recorrente".
      ...(mostrarRecorrente && leitura.ok
        ? leitura.trio
        : apagarRecorrente
          ? { recurring_value_cents: null, recurring_period: null, recurring_months: null }
          : {}),
      expected_close_date: values.expected_close_date || null,
      // Vazio volta a NULO de propósito: "não classificado" é um estado, e não
      // a ausência de uma escolha que o sistema deveria ter chutado.
      // FORK MIA (.109): o Tipo de receita some com o valor recorrente (decisão 2).
      ...(mostrarRecorrente ? { revenue_kind: values.revenue_kind ? values.revenue_kind : null } : {}),
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
      // FORK MIA (.109): primeiro os itens e o valor; se a gravação recusar, o
      // resto do formulário não sai (o erro já apareceu na tela).
      if (usarBloco) {
        const gravou = await itens.salvar();
        if (!gravou.ok) return;
      }
      await edit.mutateAsync({
        leadId: lead.id,
        patch: parsed.data as UpdateLeadInput,
      });
      setApagarRecorrente(false);
      // O que acabou de gravar vira a nova régua: o segundo salvamento não
      // reenvia o primeiro, e uma limpeza alheia no intervalo não é atropelada.
      setCamposCarregados({ ...customFields });
      toast.success(t("Negócio atualizado"));
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
          <Textarea id="description" rows={descricaoAlta ? 10 : 3} {...form.register("description")} />
        </div>

        {/* FORK MIA (.109): o bloco de itens do negócio (tela 2 do protótipo). */}
        {usarBloco && itens.rascunho ? (
          <BlocoDeItens
            itens={itens.rascunho.itens}
            onItens={(novos) => itens.setRascunho({ ...itens.rascunho!, itens: novos })}
            palavra={palavra}
            moeda={itens.moeda}
            desabilitado={edit.isPending || itens.salvando}
          />
        ) : itens.carregando ? (
          <div className="h-24 animate-pulse rounded-lg border border-border" aria-hidden />
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          {/* FORK MIA (.109): com o bloco, o Valor é a soma (ou o digitado à mão). */}
          {usarBloco && itens.rascunho && !valorPelasVendas ? (
            <div className="space-y-2">
              <CampoDoValor
                rascunho={itens.rascunho}
                onRascunho={itens.setRascunho}
                palavra={palavra}
                moeda={itens.moeda}
                desabilitado={edit.isPending || itens.salvando}
              />
              {/* FORK MIA (fusão v1.124): o "+" de registrar venda do upstream
                  continua ao alcance com o bloco. A venda conta no painel de
                  vendas; o Valor segue os itens (9167). */}
              {roleAtLeast(org?.role, "agent") && (
                <BotaoRegistrarVenda
                  leadId={lead.id}
                  titulo={lead.title}
                  moeda={moedaDoValor.toUpperCase()}
                  className="size-9 border border-border"
                  testId="valor-registrar-venda"
                />
              )}
            </div>
          ) : (
          <div className="space-y-2">
            {/* O rótulo segue a moeda do NEGÓCIO (a organização é a reserva):
                  `R$` em duro mentia para quem opera em euro. */}
            <Label htmlFor="valueReais">{t("Valor")} ({simboloDaMoeda(moedaDoValor)})</Label>
            <div className="flex items-center gap-1">
              {valorPelasVendas ? (
                <Input
                  id="valueReais"
                  readOnly
                  aria-readonly
                  data-testid="valor-pelas-vendas"
                  value={formatCents(somaDasVendas, moedaDoValor)}
                  className="bg-surface-elevated"
                />
              ) : (
                <Input
                  id="valueReais"
                  inputMode="decimal"
                  placeholder="0,00"
                  {...form.register("valueReais")}
                />
              )}
              {/* A ÚNICA porta de "registrar venda" no negócio: o "+" mora no
                  próprio Valor, e cada venda soma nele. */}
              {/* Piso do `POST /api/v1/vendas`: abaixo de `agent` o "+" só terminaria em 403. */}
              {roleAtLeast(org?.role, "agent") && (
                <BotaoRegistrarVenda
                  leadId={lead.id}
                  titulo={lead.title}
                  moeda={moedaDoValor.toUpperCase()}
                  className="size-9 border border-border"
                  testId="valor-registrar-venda"
                />
              )}
            </div>
            {valorPelasVendas ? (
              <p className="text-xs text-text-muted" data-testid="valor-pelas-vendas-legenda">
                {t("Soma de")} {vendasDoNegocio.length} {t("venda(s) registrada(s)")}
              </p>
            ) : (
              <EcoDoValor control={form.control} moeda={moedaDoValor} />
            )}
            {form.formState.errors.valueReais && (
              <p className="text-xs text-error-fg">
                {t(form.formState.errors.valueReais.message ?? "")}
              </p>
            )}
          </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="expected_close_date">{t("Fechamento previsto")}</Label>
            <Input
              id="expected_close_date"
              type="date"
              {...form.register("expected_close_date")}
            />
          </div>
        </div>

        {/* FORK MIA (metas, 0243). A duração do contrato é a coluna
            `recurring_months`, que o upstream passou a editar no bloco da
            mensalidade logo abaixo ("Duração (meses)", v1.99): o campo "Meses
            de contrato" do fork virou esse, para a coluna ter um campo só.
            A natureza da receita é o que separa mensalidade de projeto no
            relatório do mês. Vazio continua sendo uma resposta: a tela de metas
            mostra quantas vendas ficaram sem classificar, em vez de somá-las
            para um lado e inventar a divisão. */}
        {/* FORK MIA (.109): some com "Mostrar valor recorrente" desligado (decisão 2). */}
        {mostrarRecorrente ? (
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
        </div>
        ) : null}

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
            {/* A lista da equipe só é lida por quem a vê: sem a permissão, o
                componente nem monta a leitura (e o formulário do upstream não
                passa a exigir a consulta em toda tela que o usa). */}
            {podeVerEquipe ? (
              <OpcoesDaEquipe originadoPor={lead.originated_by_user_id ?? null} />
            ) : lead.originated_by_user_id ? (
              <option value={lead.originated_by_user_id}>{t("Fora da equipe atual")}</option>
            ) : null}
          </select>
        </div>

        {/* A MENSALIDADE (fatia 1 da #3602) no dossiê: o mesmo par de campos do
            diálogo do funil, com a mesma leitura — quem edita o negócio da
            conversa não deveria precisar abrir o quadro para corrigir o
            contrato. */}
        {/* FORK MIA (.109): com "Mostrar valor recorrente" desligado, o par some; o
            negócio que tem valor ali ganha o aviso para corrigir (tela 2). */}
        {!mostrarRecorrente ? (
          lead.recurring_value_cents != null ? (
            <AvisoDoValorRecorrente
              valorCents={lead.recurring_value_cents}
              moeda={moedaDoValor}
              palavra={palavra}
              apagado={apagarRecorrente}
              onApagar={() => setApagarRecorrente(true)}
            />
          ) : null
        ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="valorRecorrenteReais">
              {t("Valor recorrente (mensal)")} ({simboloDaMoeda(moedaDoValor)})
            </Label>
            <Input
              id="valorRecorrenteReais"
              inputMode="decimal"
              placeholder="0,00"
              {...form.register("valorRecorrenteReais")}
            />
            <EcoDoValor
              control={form.control}
              moeda={moedaDoValor}
              campo="valorRecorrenteReais"
            />
            {form.formState.errors.valorRecorrenteReais && (
              <p className="text-xs text-error-fg">
                {form.formState.errors.valorRecorrenteReais.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="recorrenciaMeses">{t("Duração (meses)")}</Label>
            <Input
              id="recorrenciaMeses"
              inputMode="numeric"
              placeholder={t("sem prazo")}
              {...form.register("recorrenciaMeses")}
            />
            {form.formState.errors.recorrenciaMeses && (
              <p className="text-xs text-error-fg">
                {form.formState.errors.recorrenciaMeses.message}
              </p>
            )}
          </div>
        </div>
        )}

        <div className="space-y-2">
          {/* A etiqueta do NEGÓCIO (#2979): o MESMO editor do Inbox, gravando
              na OUTRA caixa — `crm_leads.tags` por `PATCH /api/v1/leads/{id}`,
              nunca o perfil do contato. Ele grava na hora; por isso o dossiê
              não carrega mais o campo de texto livre que substituía a lista. */}
          <p className="text-sm font-medium">{t("Tags do negócio")}</p>
          <ContactTagsEditor
            entityType="lead"
            entityId={lead.id}
            pipelineId={pipelineId}
            orgId={org?.orgId ?? ""}
            tags={lead.tags ?? []}
          />
        </div>

        {fieldDefs.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">{t("Campos do funil")}</p>
            <CustomFieldsEditor
              fields={fieldDefs}
              value={customFields}
              onChange={setCustomFields}
              mode="lead"
              leadId={lead.id}
            />
          </div>
        )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={edit.isPending || itens.salvando}>
            {t("Cancelar")}
          </Button>
        )}
        <Button type="submit" disabled={edit.isPending || itens.salvando}>
          {edit.isPending || itens.salvando ? t("Salvando…") : t("Salvar")}
        </Button>
      </div>
    </form>
  );
}

/**
 * FORK MIA (metas, 0243) — as opções do "Originado por (SDR)": a equipe que pode
 * receber negócio (o mesmo picker da reatribuição, spec 13 §4). Quem originou pode
 * já ter saído do time, e a lista só traz membro ATIVO: sem a opção de reserva o
 * select abriria vazio e o salvamento apagaria, calado, a origem de uma venda
 * já fechada.
 */
function OpcoesDaEquipe({ originadoPor }: { originadoPor: string | null }) {
  const t = useT();
  const { data: membros } = useAssignableMembers(true);
  const foraDaLista = !!originadoPor && !(membros ?? []).some((m) => m.user_id === originadoPor);
  return (
    <>
      {(membros ?? []).map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name ?? t("Sem nome")}
        </option>
      ))}
      {foraDaLista && <option value={originadoPor ?? ""}>{t("Fora da equipe atual")}</option>}
    </>
  );
}
