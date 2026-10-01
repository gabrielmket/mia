"use client";

/**
 * O cartão do Outlook / Microsoft 365 na Agenda, e a faixa da volta do
 * consentimento.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 6.1). Segue o cartão do Google do
 * upstream (`CartaoDaConexaoGoogle`), com um estado a mais que o dele não tem:
 * "precisa conectar de novo", para conexão que a Microsoft derrubou (senha
 * trocada, acesso revogado). "A empresa precisa aprovar" NÃO é estado do
 * cartão: é um erro raro, mostrado só na volta em que ele acontece, com uma
 * frase curta e o link para o TI (decisão do Gabriel no protótipo).
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import { MicrosoftOutlookLogo } from "@/lib/ui/icons";

import type { EstadoDoCartaoDoOutlook } from "@/lib/agenda-mia/cartao-do-outlook";

const PRECISA_RECONECTAR = new Set(["token_expired", "scope_missing", "error"]);

function haQuanto(iso: string | null, agora: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((agora - t) / 60_000));
}

export function CartaoDoOutlook({ estado }: { estado: EstadoDoCartaoDoOutlook }) {
  const t = useT();
  const router = useRouter();
  const [desconectando, setDesconectando] = React.useState(false);
  const [agora] = React.useState(() => Date.now());

  if (!estado.configurado) {
    return (
      <div data-testid="outlook-nao-configurado" className="rounded-lg border border-border bg-surface-elevated/50 p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-text">
          <MicrosoftOutlookLogo size={16} weight="bold" className="shrink-0 text-text-muted" aria-hidden />
          {t("Outlook · Microsoft 365")}
        </p>
        {estado.linkDeConfiguracao ? (
          <>
            <p className="mt-1 text-xs leading-4 text-text-muted">
              {t("Falta cadastrar o aplicativo da Microsoft desta instalação.")}
            </p>
            <a
              href={estado.linkDeConfiguracao}
              className="mt-2 inline-block text-xs font-medium text-accent underline underline-offset-2 hover:text-accent-strong"
            >
              {t("Cadastrar as credenciais da Microsoft")}
            </a>
          </>
        ) : (
          <p className="mt-1 text-xs leading-4 text-text-muted">
            {t("Esta instalação ainda não tem a conexão com a Microsoft. Não é nada que você tenha feito.")}
          </p>
        )}
      </div>
    );
  }

  const conta = estado.contas[0];
  if (conta && PRECISA_RECONECTAR.has(conta.status)) {
    return (
      <div data-testid="outlook-reconectar" className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-bg p-3 sm:flex-row sm:items-center">
        <MicrosoftOutlookLogo size={16} weight="bold" className="shrink-0 text-text-muted" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="text-text">{t("A conexão com o Outlook parou: a Microsoft pediu para entrar de novo.")}</p>
          <p className="text-xs text-text-muted">
            {t("Enquanto isso, os compromissos continuam aqui; só não vão para o Outlook.")}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href="/api/v1/agenda/microsoft/connect">{t("Conectar de novo")}</a>
        </Button>
      </div>
    );
  }

  if (conta) {
    const minutos = haQuanto(conta.ultimaLeituraEm, agora);
    return (
      <div data-testid="outlook-conectado" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center">
        <MicrosoftOutlookLogo size={16} weight="bold" className="shrink-0 text-text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            <span className="text-text-muted">{t("Outlook conectado:")} </span>
            <span className="font-medium">{estado.contas.map((c) => c.email).join(", ")}</span>
            <span className="text-text-muted">
              {" · "}
              {conta.tipo === "pessoal" ? t("conta pessoal") : t("conta de trabalho")}
            </span>
          </p>
          <p className="text-xs text-text-muted">
            {minutos === null
              ? t("Ainda não sincronizada")
              : minutos < 1
                ? t("Última sincronização: agora")
                : `${t("Última sincronização: há")} ${minutos} min`}
            {conta.tempoReal ? ` · ${t("Tempo real ligado")}` : ""}
          </p>
        </div>
        <a href="/app/settings/tenant/agenda" className="text-xs underline">
          {t("Configurar suas agendas")}
        </a>
        <Button
          variant="outline"
          size="sm"
          data-testid="desconectar-outlook"
          disabled={desconectando}
          onClick={() => {
            setDesconectando(true);
            void fetch("/api/v1/agenda/microsoft/desconectar", { method: "DELETE" })
              .then(async (r) => {
                if (!r.ok) throw new Error(await r.text());
                router.refresh();
              })
              .catch(() => setDesconectando(false));
          }}
        >
          {desconectando ? t("Desconectando…") : t("Desconectar")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-sm text-text-muted">
        {t(
          "Conecte sua agenda do Outlook para ver aqui o que já está marcado lá, e enviar para lá o que for marcado aqui. Serve conta de trabalho (Microsoft 365) e pessoal (outlook.com).",
        )}
      </p>
      <Button variant="outline" size="sm" data-testid="conectar-outlook" asChild>
        <a href="/api/v1/agenda/microsoft/connect">
          <MicrosoftOutlookLogo size={16} weight="bold" aria-hidden />
          <span>{t("Conectar Outlook")}</span>
        </a>
      </Button>
    </div>
  );
}

/** Os desfechos da volta que viram faixa (os outros viram só um aviso rápido). */
const ERROS: Record<string, { titulo: string; texto: string; reconectar: boolean }> = {
  nao_configurado: {
    titulo: "Esta instalação ainda não tem a conexão com a Microsoft configurada",
    texto: "Fale com quem administra o sistema.",
    reconectar: false,
  },
  segredo_indisponivel: {
    titulo: "Não consegui começar a conexão com o Outlook",
    texto: "Fale com quem administra o sistema.",
    reconectar: false,
  },
  cifra_indisponivel: {
    titulo: "Não consegui guardar a conexão com segurança",
    texto: "Fale com quem administra o sistema.",
    reconectar: false,
  },
  retorno_nao_verificavel: {
    titulo: "A conexão demorou demais e expirou",
    texto: "Conecte de novo pelo cartão do Outlook.",
    reconectar: true,
  },
  retorno_incompleto: {
    titulo: "A Microsoft devolveu uma resposta incompleta",
    texto: "Conecte de novo pelo cartão do Outlook.",
    reconectar: true,
  },
  troca_de_codigo_falhou: {
    titulo: "A Microsoft não confirmou a conexão",
    texto: "Conecte de novo. Se continuar, fale com quem administra o sistema.",
    reconectar: true,
  },
  conta_indisponivel: {
    titulo: "Não consegui ler os dados da conta da Microsoft",
    texto: "Conecte de novo pelo cartão do Outlook.",
    reconectar: true,
  },
  permissao_incompleta: {
    titulo: "Faltou permissão para ler e escrever na sua agenda",
    texto: "Conecte de novo e aceite todas as permissões pedidas.",
    reconectar: true,
  },
  sem_token_de_renovacao: {
    titulo: "A Microsoft não liberou o acesso contínuo à agenda",
    texto: "Conecte de novo e aceite todas as permissões pedidas.",
    reconectar: true,
  },
  nao_consegui_guardar: {
    titulo: "A conexão funcionou, mas não consegui salvar",
    texto: "Conecte de novo pelo cartão do Outlook.",
    reconectar: true,
  },
  empresa_de_demonstracao: {
    titulo: "A empresa de demonstração não conecta agenda de fora",
    texto: "Nada sai da demonstração: nem convite por e-mail, nem reunião do Teams.",
    reconectar: false,
  },
  ti_nao_aprovou: {
    titulo: "A aprovação do TI não foi concluída",
    texto: "Peça ao administrador de TI para abrir o link de novo e aprovar.",
    reconectar: false,
  },
};

export function AvisoDaConexaoOutlook({ linkDoTi }: { linkDoTi: string | null }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const ok = params.get("ms_ok");
  const erro = params.get("ms_erro");
  const [fixo, setFixo] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!ok && !erro) return;
    if (ok === "agenda_conectada") {
      toast.success(t("Agenda do Outlook conectada."), {
        description: t("Os compromissos que já estão lá aparecem aqui como ocupado."),
      });
    } else if (ok === "ti_aprovou") {
      toast.success(t("O TI aprovou o aplicativo."), { description: t("Agora é só conectar o Outlook.") });
    } else if (erro === "conexao_cancelada") {
      toast(t("Você cancelou a conexão."), { description: t("Nada mudou. Quando quiser, é só conectar de novo.") });
    } else if (erro) {
      setFixo(erro);
    }
    router.replace("/app/agenda");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, erro]);

  if (!fixo) return null;

  if (fixo === "precisa_aprovacao") {
    return (
      <div role="alert" data-testid="outlook-precisa-aprovacao" className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-bg p-3 text-sm sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-text">
          {t("A empresa bloqueou a conexão com aplicativos externos. Peça ao TI para aprovar uma vez:")}
        </p>
        {linkDoTi ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void copyToClipboard(linkDoTi).then((copiou) =>
                copiou
                  ? toast.success(t("Link copiado."))
                  : toast.error(t("Não deu para copiar. Peça o link a quem administra o sistema.")),
              );
            }}
          >
            {t("Copiar link para o TI")}
          </Button>
        ) : null}
      </div>
    );
  }

  const conteudo = ERROS[fixo] ?? {
    titulo: "Não consegui conectar sua agenda do Outlook",
    texto: "O resto da agenda continua funcionando normalmente. Tentar de novo costuma resolver.",
    reconectar: true,
  };
  return (
    <div role="alert" data-testid={`outlook-erro-${fixo}`} className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-bg p-3 text-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text">{t(conteudo.titulo)}</p>
        <p className="text-xs text-text-muted">{t(conteudo.texto)}</p>
      </div>
      {conteudo.reconectar ? (
        <Button variant="outline" size="sm" asChild>
          <a href="/api/v1/agenda/microsoft/connect">{t("Conectar de novo")}</a>
        </Button>
      ) : null}
    </div>
  );
}

/** O cartão e a faixa juntos: o que a Agenda do upstream recebe numa linha só. */
export function ConexaoDoOutlookNaAgenda({ estado }: { estado: EstadoDoCartaoDoOutlook }) {
  return (
    <>
      <React.Suspense fallback={null}>
        <AvisoDaConexaoOutlook linkDoTi={estado.linkDoTi} />
      </React.Suspense>
      <CartaoDoOutlook estado={estado} />
    </>
  );
}
