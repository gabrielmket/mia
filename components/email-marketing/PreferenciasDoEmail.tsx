"use client";

/**
 * FORK MIA (.89) — o formulário da PÁGINA DE PREFERÊNCIAS (`/preferencias/[token]`).
 *
 * Sair (de todo e-mail de marketing da empresa e, se a pessoa marcar, também do
 * marketing pelo WhatsApp), com o motivo opcional; ou voltar a receber, que só
 * a própria pessoa faz, e só por aqui. Pedidos, agendamentos e atendimento não
 * mudam. No e-mail de TESTE, nada é gravado e a página diz isso.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

const TOQUE = "min-h-11 lg:min-h-0";

interface Situacao {
  saiu: boolean;
  saiuEm: string | null;
  motivoDaSaida: string | null;
  podeVoltar: boolean;
  recusouWhatsapp: boolean;
}

/** Os motivos que a pessoa pode marcar (opcional). O valor gravado é o código. */
const MOTIVOS = {
  muitos: "Recebo e-mails demais",
  nao_interessa: "O assunto não me interessa mais",
  nao_pedi: "Não me lembro de ter pedido",
  outro: "Outro motivo",
} as const;

export function PreferenciasDoEmail(props: {
  token: string;
  teste: boolean;
  empresaNome: string;
  situacaoInicial: Situacao;
  sairEscolhido: boolean;
  abaInicial: "preferencias" | "privacidade";
  privacidadeUrl: string | null;
  privacidadeTexto: string[] | null;
}) {
  const t = useT();
  const [aba, setAba] = useState(props.abaInicial);
  const [situacao, setSituacao] = useState<Situacao>(props.situacaoInicial);
  const [tambemWhatsapp, setTambemWhatsapp] = useState(false);
  const [motivo, setMotivo] = useState<keyof typeof MOTIVOS | "">("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<"saiu" | "voltou" | "teste" | null>(null);

  async function gravar(acao: "sair" | "voltar") {
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(
        `/api/v1/webhooks/email-marketing/preferencias/${encodeURIComponent(props.token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            acao === "sair"
              ? { acao, tambem_whatsapp: tambemWhatsapp, motivo: motivo || null }
              : { acao },
          ),
        },
      );
      const json = (await r.json().catch(() => null)) as {
        data?: { teste?: boolean; situacao?: Situacao };
      } | null;
      if (!r.ok || !json?.data?.situacao) {
        setErro(
          r.status === 429
            ? t("Muitas tentativas. Aguarde um minuto.")
            : t("Não deu certo agora. Tente de novo em alguns minutos."),
        );
        return;
      }
      setSituacao(json.data.situacao);
      setFeito(json.data.teste ? "teste" : acao === "sair" ? "saiu" : "voltou");
    } catch {
      setErro(t("Não deu certo agora. Tente de novo em alguns minutos."));
    } finally {
      setEnviando(false);
    }
  }

  const temPrivacidade = !!props.privacidadeUrl || !!props.privacidadeTexto;

  return (
    <div className="space-y-4" data-preferencias={situacao.saiu ? "saiu" : "recebe"}>
      {props.teste ? (
        <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg">
          {t(
            "Este é um e-mail de teste: a página mostra o que a pessoa veria, e nada do que você escolher aqui é gravado.",
          )}
        </p>
      ) : null}

      {temPrivacidade ? (
        <nav className="flex gap-2" aria-label={t("Seções")}>
          <Button
            variant={aba === "preferencias" ? "default" : "outline"}
            size="sm"
            onClick={() => setAba("preferencias")}
            aria-current={aba === "preferencias" ? "page" : undefined}
          >
            {t("Preferências")}
          </Button>
          <Button
            variant={aba === "privacidade" ? "default" : "outline"}
            size="sm"
            onClick={() => setAba("privacidade")}
            aria-current={aba === "privacidade" ? "page" : undefined}
          >
            {t("Privacidade")}
          </Button>
        </nav>
      ) : null}

      {aba === "privacidade" && temPrivacidade ? (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5 text-sm">
          {props.privacidadeUrl ? (
            <p>
              {t("A política de privacidade de {empresa} está em:").replace(
                "{empresa}",
                props.empresaNome,
              )}{" "}
              <a
                className="underline"
                href={props.privacidadeUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {props.privacidadeUrl}
              </a>
            </p>
          ) : (
            (props.privacidadeTexto ?? []).map((p, i) =>
              i === 0 ? (
                <h2 key={i} className="text-base font-semibold">
                  {p}
                </h2>
              ) : (
                <p key={i}>{p}</p>
              ),
            )
          )}
        </section>
      ) : (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          {feito === "teste" ? (
            <p className="text-sm text-info-fg">{t("Modo de teste: nada foi gravado.")}</p>
          ) : feito === "saiu" ? (
            <p className="text-sm text-success-fg">
              {t("Pronto: você não recebe mais e-mails de marketing desta empresa.")}
            </p>
          ) : feito === "voltou" ? (
            <p className="text-sm text-success-fg">
              {t("Pronto: você volta a receber os e-mails desta empresa.")}
            </p>
          ) : null}

          {situacao.saiu ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">
                {t("Você não recebe e-mails de marketing desta empresa")}
              </h2>
              <p className="text-sm text-text-muted">
                {t("Pedidos, agendamentos e atendimento continuam chegando normalmente.")}
              </p>
              {situacao.podeVoltar ? (
                <Button
                  className={TOQUE}
                  variant="outline"
                  disabled={enviando}
                  onClick={() => void gravar("voltar")}
                >
                  {enviando ? t("Gravando…") : t("Voltar a receber")}
                </Button>
              ) : (
                <p className="text-xs text-text-muted">
                  {t(
                    "Este endereço não pode voltar a receber, porque as mensagens não chegaram até ele.",
                  )}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">
                {props.sairEscolhido
                  ? t("Sair da lista de e-mails")
                  : t("Você recebe os e-mails de marketing desta empresa")}
              </h2>
              <p className="text-sm text-text-muted">
                {t(
                  "Ao sair, você deixa de receber novidades e ofertas por e-mail. Pedidos, agendamentos e atendimento continuam chegando normalmente.",
                )}
              </p>
              <label className={`flex items-start gap-2 text-sm ${TOQUE}`}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={tambemWhatsapp}
                  onChange={(e) => setTambemWhatsapp(e.target.checked)}
                  disabled={situacao.recusouWhatsapp}
                />
                <span>
                  {situacao.recusouWhatsapp
                    ? t("Você já não recebe mensagens de marketing pelo WhatsApp.")
                    : t("Também não quero receber mensagens de marketing pelo WhatsApp.")}
                </span>
              </label>
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">
                  {t("Quer contar por quê? (opcional)")}
                </legend>
                {(Object.keys(MOTIVOS) as Array<keyof typeof MOTIVOS>).map((k) => (
                  <label key={k} className={`flex items-center gap-2 text-sm ${TOQUE}`}>
                    <input
                      type="radio"
                      name="motivo"
                      value={k}
                      checked={motivo === k}
                      onChange={() => setMotivo(k)}
                    />
                    {t(MOTIVOS[k])}
                  </label>
                ))}
              </fieldset>
              <Button
                className={TOQUE}
                variant={props.sairEscolhido ? "destructive" : "outline"}
                disabled={enviando}
                onClick={() => void gravar("sair")}
              >
                {enviando ? t("Gravando…") : t("Sair da lista")}
              </Button>
            </div>
          )}
          {erro ? <p className="text-sm text-error-fg">{erro}</p> : null}
        </section>
      )}
    </div>
  );
}
