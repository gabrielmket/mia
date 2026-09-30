"use client";

/**
 * FORK MIA — montar um disparo pelo NÚMERO OFICIAL, conferir e só então disparar.
 *
 * Era o miolo do antigo `MiaBroadcast.tsx`, e ganhou o molde do formulário de
 * Campanhas do upstream (seções Informações → Público → Mensagem → Custo) na
 * unificação da .58 (docs/fork/broadcast-unificado.md). O motor é o mesmo.
 *
 * ── A ordem é o produto ────────────────────────────────────────────────────
 *
 * Criar NÃO dispara. O disparo nasce em rascunho e a tela mostra a peneira:
 * quantos entraram, quantos ficaram de fora e por quê, e o custo. Só então
 * aparece o botão de disparar. Juntar as duas coisas tiraria o único momento em
 * que dá para descobrir que 900 dos 4.000 contatos não têm telefone.
 *
 * ── O que a tela recusa, e por quê ─────────────────────────────────────────
 *
 * Modelo não aprovado, saldo que não cobre a lista, lista vazia. Cada recusa vem
 * com o motivo e, quando é saldo, com quanto falta — recusar sem dizer quanto
 * recarregar obriga a pessoa a fazer a conta de cabeça.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useTemplates } from "@/hooks/channels/useTemplates";
import { useCarteira } from "@/hooks/useCarteira";
import {
  useCriarCampanha,
  useDispararCampanha,
  type CampanhaCriada,
} from "@/hooks/useBroadcasts";
import { formatCentsBRL } from "@/lib/money";

import { SeletorDeEtapas } from "./SeletorDeEtapas";
import { SeletorDeTags } from "./SeletorDeTags";
import { fraseDoMotivo } from "./textos";

/**
 * Como o slot se apresenta a quem preenche.
 *
 * `{{2}}` diz tudo sobre uma variável de texto e nada sobre um cabeçalho de
 * mídia — ali o operador precisa saber que se espera um ARQUIVO, não uma
 * palavra. Um campo pedindo "{{1}}" para uma imagem é a forma mais curta de
 * receber o nome do contato onde deveria ir uma foto.
 */
function rotuloDoSlot(
  slot: { chave: string; key: string; expects: string },
  t: (texto: string) => string,
): string {
  switch (slot.expects) {
    case "image":
      return t("Imagem");
    case "video":
      return t("Vídeo");
    case "document":
      return t("Documento");
    default:
      return `{{${slot.key}}}`;
  }
}

/**
 * Sobe o arquivo direto para a conta do WhatsApp e devolve o valor pronto para
 * o campo (`meta-media:<id>`, com o nome grudado quando é PDF).
 *
 * Estado local e não global: cada slot de mídia tem o seu, e um estado
 * compartilhado faria o "enviando…" de um piscar no outro.
 */
function SeletorDeArquivo({ onEnviado }: { onEnviado: (valor: string) => void }) {
  const t = useT();
  const [enviando, setEnviando] = useState(false);

  return (
    <div className="space-y-1">
      <input
        type="file"
        accept="image/jpeg,image/png,video/mp4,application/pdf"
        disabled={enviando}
        className="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1"
        onChange={async (e) => {
          const arquivo = e.target.files?.[0];
          if (!arquivo) return;
          setEnviando(true);
          try {
            const corpo = new FormData();
            corpo.append("file", arquivo);
            const r = await fetch("/api/v1/broadcasts/midia", { method: "POST", body: corpo });
            const json = (await r.json()) as {
              data?: { valor?: string };
              error?: { message?: string };
            };
            if (!r.ok || !json.data?.valor) {
              toast.error(json.error?.message ?? t("Não consegui enviar o arquivo."));
              return;
            }
            onEnviado(json.data.valor);
            toast.success(t("Arquivo enviado."));
          } finally {
            setEnviando(false);
            // Limpa o input para o MESMO arquivo poder ser escolhido de novo
            // depois de um erro — sem isto, o segundo clique não dispara evento.
            e.target.value = "";
          }
        }}
      />
      {enviando && <p className="text-xs text-muted-foreground">{t("Enviando o arquivo…")}</p>}
    </div>
  );
}

export function FormularioDoOficial() {
  const t = useT();
  const router = useRouter();
  const { data: templatesRes } = useTemplates();
  const { data: carteira } = useCarteira();
  const criar = useCriarCampanha();
  const disparar = useDispararCampanha();

  const [nome, setNome] = useState("");
  const [template, setTemplate] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  // Funil e etapa: o filtro que responde "onde a negociação está", ao lado do
  // de tag, que responde "quem a pessoa é". Os dois se somam como E.
  const [funil, setFunil] = useState<string | null>(null);
  const [etapas, setEtapas] = useState<string[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [recemCriada, setRecemCriada] = useState<CampanhaCriada | null>(null);

  // Só APPROVED entra no seletor: oferecer um pendente seria montar uma campanha
  // que a própria tela recusaria na hora de disparar.
  const aprovados = (templatesRes?.data.templates ?? []).filter((x) => x.status === "APPROVED");
  const escolhido = aprovados.find((x) => `${x.name}:${x.language}` === template) ?? null;

  /**
   * Só a variável `1` DO CORPO é automática (o nome de cada contato). Todo o
   * resto vira campo — inclusive o cabeçalho de mídia, que nasce com a mesma
   * chave crua `1`. Os slots vêm DERIVADOS pela API a partir do modelo
   * espelhado, nunca contados aqui: contar `{{n}}` à mão seria uma segunda
   * régua, que divergiria da Meta na primeira mudança.
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
        `${t("Preencha as variáveis do template:")} ${faltamValores.map((s) => rotuloDoSlot(s, t)).join(", ")}`,
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
        etapas,
        variavel_do_nome: "1",
      },
      {
        onSuccess: (r) => setRecemCriada(r.data),
        onError: (e: unknown) => {
          toast.error(e instanceof Error ? e.message : t("Não consegui montar a campanha."));
        },
      },
    );
  }

  if (recemCriada) {
    return (
      <Card className="space-y-3 p-4" data-conferencia>
        <h2 className="font-medium">{t("Confira antes de disparar")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("A lista está montada e nada foi enviado ainda.")}
        </p>
        <p className="text-2xl font-semibold tabular-nums">
          {recemCriada.destinatarios} {t("destinatários")}
        </p>
        {/* A peneira INTEIRA: lista que encolhe sem explicação parece defeito
            do sistema, e cada número aqui é informação sobre a base. */}
        <p className="text-sm text-muted-foreground">
          {t("Ficaram de fora:")} {recemCriada.fora.sem_telefone} {t("sem telefone")} ·{" "}
          {recemCriada.fora.repetidos} {t("repetidos")} · {recemCriada.fora.pediram_para_sair}{" "}
          {t("pediram para sair")}
        </p>
        {recemCriada.custo_estimado_cents !== null ? (
          <p className="text-sm">
            {t("Custo estimado:")}{" "}
            <strong className="tabular-nums">{formatCentsBRL(recemCriada.custo_estimado_cents)}</strong>
          </p>
        ) : null}

        {recemCriada.pode_disparar ? null : (
          <p className="text-sm text-error-fg">
            {fraseDoMotivo(recemCriada.motivo, t)}
            {recemCriada.falta_cents ? ` ${t("Faltam")} ${formatCentsBRL(recemCriada.falta_cents)}.` : ""}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {recemCriada.pode_disparar ? (
            <Button
              disabled={disparar.isPending}
              onClick={() =>
                disparar.mutate(recemCriada.id, {
                  onSuccess: () => {
                    toast.success(t("Disparo começou. O envio acontece em segundo plano."));
                    router.push(`/app/broadcast/${recemCriada.id}`);
                  },
                  onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : t("Não consegui disparar.")),
                })
              }
            >
              {disparar.isPending ? t("Disparando…") : t("Disparar agora")}
            </Button>
          ) : null}
          {/* Agendar, renomear e trocar o modelo moram no disparo aberto. */}
          <Button variant="outline" asChild>
            <Link href={`/app/broadcast/${recemCriada.id}`}>{t("Abrir a campanha")}</Link>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <h2 className="font-medium">{t("Informações")}</h2>
        <div className="space-y-2">
          <Label htmlFor="bc-nome">{t("Nome da campanha")}</Label>
          <Input
            id="bc-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={t("Retomada setembro")}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="font-medium">{t("Público")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Sem filtro, entram todos os contatos com telefone. Você confere a lista antes de disparar.")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <SeletorDeTags selecionadas={tags} onChange={setTags} disabled={criar.isPending} />
          <SeletorDeEtapas
            funil={funil}
            aoMudarFunil={setFunil}
            etapas={etapas}
            aoMudarEtapas={setEtapas}
            disabled={criar.isPending}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="font-medium">{t("Mensagem")}</h2>
        <div className="space-y-2">
          <Label htmlFor="bc-tpl">{t("Template aprovado")}</Label>
          <select
            id="bc-tpl"
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
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
            <p className="text-sm text-warning-fg">
              {t("Nenhum template aprovado ainda — crie um em Conexões › Templates da Meta.")}
            </p>
          ) : null}
        </div>

        {/*
          AS VARIÁVEIS DO MODELO. Só aparece quando o escolhido pede mais que a
          variável 1, que é automática (o nome de cada contato). As demais valem
          para a lista inteira, então se digitam uma vez.
        */}
        {slotsManuais.length > 0 ? (
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
            <p className="text-sm font-medium">{t("Este template pede mais informação")}</p>
            <p className="text-sm text-muted-foreground">
              {t(
                "A variável {{1}} é preenchida com o nome de cada contato. As de baixo são iguais para a lista toda.",
              )}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {slotsManuais.map((slot) => (
                <div key={slot.chave} className="space-y-1">
                  <Label htmlFor={`bc-var-${slot.chave}`}>
                    {rotuloDoSlot(slot, t)}{" "}
                    <span className="font-normal text-muted-foreground">({t(slot.onde)})</span>
                  </Label>
                  <Input
                    id={`bc-var-${slot.chave}`}
                    value={valores[slot.chave] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [slot.chave]: e.target.value }))}
                    placeholder={
                      slot.expects === "text"
                        ? t("o mesmo texto para todos")
                        : t("escolha o arquivo abaixo, ou cole um endereço público")
                    }
                  />
                  {/*
                    O ARQUIVO, sem hospedar arquivo: o campo continua aceitando
                    URL, mas deixa de ser a única saída — a URL do Drive devolve
                    HTML em vez da imagem, erro que só aparecia depois do
                    disparo, com o crédito já gasto.
                  */}
                  {slot.expects !== "text" && (
                    <SeletorDeArquivo
                      onEnviado={(valor) => setValores((v) => ({ ...v, [slot.chave]: valor }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-2 p-4" data-custo>
        <h2 className="font-medium">{t("Custo")}</h2>
        <p className="text-sm">
          {carteira?.preco_por_mensagem_cents == null
            ? t("Sem preço por mensagem acordado — fale com quem cuida da sua conta antes de montar.")
            : `${formatCentsBRL(carteira.preco_por_mensagem_cents)} ${t("por mensagem")} · ${t("Saldo:")} ${formatCentsBRL(carteira.saldo_cents)}`}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("O custo total aparece na conferência, antes de disparar: preço por mensagem vezes quem entrou na lista.")}
        </p>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/app/broadcast")}>
          {t("Cancelar")}
        </Button>
        {/*
          Desabilitar em vez de deixar clicar e recusar: a recusa da Meta viria
          destinatário a destinatário, DEPOIS de o disparo existir — e foi assim
          que 3 de 3 falharam sem a tela ter avisado nada.
        */}
        <Button onClick={montar} disabled={criar.isPending || faltamValores.length > 0}>
          {criar.isPending ? t("Montando…") : t("Montar lista")}
        </Button>
      </div>
      {faltamValores.length > 0 ? (
        <p className="text-right text-sm text-warning-fg">
          {t("Preencha as variáveis do template:")} {faltamValores.map((s) => `{{${s.key}}}`).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
