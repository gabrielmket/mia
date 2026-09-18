"use client";

/**
 * MIA BROADCAST — montar, conferir e disparar.
 *
 * ── Duas telas num fluxo só, e a ordem é o produto ──────────────────────────
 *
 * Criar NÃO dispara. A campanha nasce em rascunho e a tela mostra a peneira:
 * quantos entraram, quantos ficaram de fora e por quê. Só então aparece o botão
 * de disparar, com o custo estimado ao lado.
 *
 * Juntar as duas coisas (um botão "criar e disparar") tiraria o único momento
 * em que dá para descobrir que 900 dos 4.000 contatos não têm telefone — e essa
 * descoberta depois do disparo não serve para nada.
 *
 * ── O que a tela recusa, e por quê ──────────────────────────────────────────
 *
 * Template não aprovado, saldo que não cobre a lista, lista vazia. Cada recusa
 * vem com o motivo em português e, quando é saldo, com quanto falta — recusar
 * sem dizer quanto recarregar obriga a pessoa a fazer a conta de cabeça.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useTemplates } from "@/hooks/channels/useTemplates";
import { useCarteira } from "@/hooks/useCarteira";
import {
  useBroadcasts,
  useCriarCampanha,
  useDispararCampanha,
  type Campanha,
  type CampanhaCriada,
} from "@/hooks/useBroadcasts";
import { formatCentsBRL } from "@/lib/money";
import { CartaoDaCampanha } from "./CartaoDaCampanha";
import { SeletorDeTags } from "./SeletorDeTags";

const ROTULO_DO_STATUS: Record<Campanha["status"], string> = {
  rascunho: "Rascunho",
  agendada: "Agendada",
  enviando: "Enviando",
  pausada: "Pausada",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

/**
 * Como o slot se apresenta a quem preenche.
 *
 * `{{2}}` diz tudo sobre uma variável de texto e nada sobre um cabeçalho de
 * mídia — ali o operador precisa saber que se espera um ARQUIVO, não uma
 * palavra. Um campo pedindo "{{1}}" para uma imagem é a forma mais curta de
 * receber o nome do contato onde deveria ir uma foto.
 */
function rotuloDoSlot(slot: { chave: string; key: string; expects: string }): string {
  switch (slot.expects) {
    case "image":
      return "Imagem";
    case "video":
      return "Vídeo";
    case "document":
      return "Documento";
    default:
      return `{{${slot.key}}}`;
  }
}

const MOTIVO: Record<string, string> = {
  sem_preco_acordado: "Ainda não há preço por mensagem acordado para esta empresa.",
  saldo_insuficiente: "O crédito não cobre a lista inteira.",
  template_nao_aprovado: "Este template ainda não foi aprovado pela Meta.",
  sem_canal: "Nenhum número oficial conectado.",
  numero_em_risco: "O número está com qualidade baixa na Meta — disparar agora acelera o bloqueio.",
  lista_vazia: "Nenhum contato entrou na lista.",
  saldo_acabou: "O crédito acabou no meio do disparo.",
};

export function MiaBroadcast() {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data: campanhas, isLoading } = useBroadcasts();
  const { data: templatesRes } = useTemplates();
  const { data: carteira } = useCarteira();
  const criar = useCriarCampanha();
  const disparar = useDispararCampanha();

  const [nome, setNome] = useState("");
  const [template, setTemplate] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [recemCriada, setRecemCriada] = useState<CampanhaCriada | null>(null);

  // Só APPROVED entra no seletor: oferecer um pendente seria montar uma campanha
  // que a própria tela recusaria na hora de disparar.
  const aprovados = (templatesRes?.data.templates ?? []).filter((x) => x.status === "APPROVED");
  const escolhido = aprovados.find((x) => `${x.name}:${x.language}` === template) ?? null;

  /**
   * AS VARIÁVEIS ALÉM DO NOME — o que faltava, e o que fez 3 de 3 falharem.
   *
   * A tela cravava `variavel_do_nome: "1"` e mandava `valores_padrao: {}`. Isso
   * basta para template de uma variável e é ERRADO para qualquer outro: a Meta
   * recusa quando a quantidade de parâmetros não bate, e a campanha inteira
   * falhava sem a tela ter avisado nada — porque ela nem sabia quantas o
   * template pedia.
   *
   * Os slots são DERIVADOS pela API a partir do template espelhado, nunca
   * contados aqui. A `1` continua automática (é o nome do contato, que varia por
   * destinatário); as demais são iguais para a lista toda, então o operador
   * digita uma vez.
   */
  /**
   * Só a variável `1` DO CORPO é automática (o nome de cada contato). Todo o
   * resto vira campo — inclusive o cabeçalho de mídia, que nasce com a mesma
   * chave crua `1` e por isso era descartado aqui: a tela nunca perguntava a
   * imagem e o disparo saía sem ela.
   */
  const slotsManuais = (escolhido?.slots ?? []).filter((s) => s.chave !== "1");
  const faltamValores = slotsManuais.filter((s) => !(valores[s.chave] ?? "").trim());

  function montar() {
    if (!nome.trim() || !escolhido) {
      toast.error(t("Dê um nome e escolha um template aprovado."));
      return;
    }
    // Recusa AQUI em vez de deixar a Meta recusar lá: falhar 3 de 3 é barato,
    // falhar 3.000 de 3.000 não é — e o motivo só apareceria destinatário a
    // destinatário, depois de gasto.
    if (faltamValores.length > 0) {
      toast.error(
        `${t("Preencha as variáveis do template:")} ${faltamValores.map((s) => rotuloDoSlot(s)).join(", ")}`,
      );
      return;
    }
    criar.mutate(
      {
        nome: nome.trim(),
        template_name: escolhido.name,
        template_language: escolhido.language,
        valores_padrao: Object.fromEntries(
          // A chave QUALIFICADA: é por ela que `buildComponents` procura o valor.
          slotsManuais.map((s) => [s.chave, (valores[s.chave] ?? "").trim()]),
        ),
        tags,
        variavel_do_nome: "1",
      },
      {
        onSuccess: (r) => {
          setRecemCriada(r.data);
          setNome("");
          setValores({});
          setTags([]);
        },
        onError: (e: unknown) => {
          toast.error(e instanceof Error ? e.message : t("Não consegui montar a campanha."));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-md border border-border p-4">
        <h2 className="text-sm font-medium">{t("Nova campanha")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {carteira?.preco_por_mensagem_cents == null
            ? t("Sem preço por mensagem acordado — fale com quem cuida da sua conta antes de montar.")
            : `${t("Saldo:")} ${formatCentsBRL(carteira.saldo_cents)} · ${formatCentsBRL(
                carteira.preco_por_mensagem_cents,
              )} ${t("por mensagem")}`}
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="bc-nome">{t("Nome da campanha")}</Label>
            <Input
              id="bc-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("Retomada setembro")}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bc-tpl">{t("Template aprovado")}</Label>
            <select
              id="bc-tpl"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="">{t("Escolha…")}</option>
              {aprovados.map((x) => (
                <option key={`${x.name}:${x.language}`} value={`${x.name}:${x.language}`}>
                  {x.name} ({x.language})
                </option>
              ))}
            </select>
            {aprovados.length === 0 ? (
              <p className="text-xs text-warning-fg">
                {t("Nenhum template aprovado ainda — crie um em Conexões › Templates da Meta.")}
              </p>
            ) : null}
          </div>
          <SeletorDeTags selecionadas={tags} onChange={setTags} disabled={criar.isPending} />
        </div>

        {/*
          AS VARIÁVEIS DO TEMPLATE — o campo que faltava.

          Só aparece quando o template escolhido pede mais que a variável 1, que
          é automática (o nome do contato, e portanto diferente a cada
          destinatário). As demais valem para a lista inteira, então se digita
          uma vez — e é isso que as torna preenchíveis aqui em vez de exigirem
          planilha.

          Os slots vêm DERIVADOS da API a partir do template espelhado. Contar
          `{{n}}` à mão aqui seria uma segunda régua, que divergiria da Meta na
          primeira mudança.
        */}
        {slotsManuais.length > 0 ? (
          <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3">
            <p className="text-xs font-medium">
              {t("Este template pede mais informação")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t(
                "A variável {{1}} é preenchida com o nome de cada contato. As de baixo são iguais para a lista toda.",
              )}
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {slotsManuais.map((slot) => (
                <div key={slot.chave} className="space-y-1">
                  <Label htmlFor={`bc-var-${slot.chave}`}>
                    {rotuloDoSlot(slot)}{" "}
                    <span className="font-normal text-muted-foreground">({t(slot.onde)})</span>
                  </Label>
                  <Input
                    id={`bc-var-${slot.chave}`}
                    value={valores[slot.chave] ?? ""}
                    onChange={(e) =>
                      setValores((v) => ({ ...v, [slot.chave]: e.target.value }))
                    }
                    placeholder={
                      slot.expects === "text"
                        ? t("o mesmo texto para todos")
                        : t("endereço público do arquivo (https://…)")
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/*
          Desabilitar em vez de deixar clicar e recusar: a recusa da Meta viria
          destinatário a destinatário, DEPOIS de a campanha existir — e foi
          exatamente assim que 3 de 3 falharam sem a tela ter avisado nada.
        */}
        <Button
          className="mt-3"
          onClick={montar}
          disabled={criar.isPending || faltamValores.length > 0}
        >
          {criar.isPending ? t("Montando…") : t("Montar lista")}
        </Button>
        {faltamValores.length > 0 ? (
          <p className="mt-1.5 text-xs text-warning-fg">
            {t("Preencha as variáveis do template:")}{" "}
            {faltamValores.map((s) => `{{${s.key}}}`).join(", ")}
          </p>
        ) : null}
      </section>

      {recemCriada ? (
        <section className="rounded-md border border-border p-4">
          <h2 className="text-sm font-medium">{t("Confira antes de disparar")}</h2>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {recemCriada.destinatarios} {t("destinatários")}
          </p>
          {/* A peneira INTEIRA: lista que encolhe sem explicação parece defeito
              do sistema, e cada número aqui é informação sobre a base. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Ficaram de fora:")} {recemCriada.fora.sem_telefone} {t("sem telefone")} ·{" "}
            {recemCriada.fora.repetidos} {t("repetidos")} · {recemCriada.fora.pediram_para_sair}{" "}
            {t("pediram para sair")}
          </p>
          {recemCriada.custo_estimado_cents !== null ? (
            <p className="mt-2 text-sm">
              {t("Custo estimado:")}{" "}
              <strong className="tabular-nums">
                {formatCentsBRL(recemCriada.custo_estimado_cents)}
              </strong>
            </p>
          ) : null}

          {recemCriada.pode_disparar ? (
            <Button
              className="mt-3"
              disabled={disparar.isPending}
              onClick={() =>
                disparar.mutate(recemCriada.id, {
                  onSuccess: () => {
                    toast.success(t("Disparo começou. O envio acontece em segundo plano."));
                    setRecemCriada(null);
                  },
                  onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : t("Não consegui disparar.")),
                })
              }
            >
              {disparar.isPending ? t("Disparando…") : t("Disparar agora")}
            </Button>
          ) : (
            <p className="mt-3 text-sm text-error-fg">
              {t(MOTIVO[recemCriada.motivo ?? ""] ?? "Não dá para disparar ainda.")}
              {recemCriada.falta_cents
                ? ` ${t("Faltam")} ${formatCentsBRL(recemCriada.falta_cents)}.`
                : ""}
            </p>
          )}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t("Campanhas")}</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>
        ) : (campanhas ?? []).length === 0 ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            {t("Nenhuma campanha ainda.")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {(campanhas ?? []).map((c) => (
              <CartaoDaCampanha
                key={c.id}
                campanha={c}
                rotuloDoStatus={ROTULO_DO_STATUS}
                motivo={MOTIVO}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
