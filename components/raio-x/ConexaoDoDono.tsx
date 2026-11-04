"use client";

/**
 * FORK MIA (.101) · A PÁGINA DE CONEXÃO DO DONO (protótipo, tela 3): autorizar,
 * conectar pelo código de 8 letras (ou pelo QR) e acompanhar a leitura. Sem
 * login: a identidade é o código do link. Quem lê é o servidor, não o navegador:
 * o dono pode fechar a página depois de conectar.
 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import type { EtapaPublica, SituacaoPublica } from "@/lib/raio-x/publico";

const INTERVALO_DO_ANDAMENTO_MS = 5_000;
const INTERVALO_DO_QR_MS = 20_000;

interface Resposta<T> {
  data?: T;
  error?: { message?: string };
}

async function pedir<T>(url: string, metodo: "GET" | "POST", corpo?: unknown): Promise<{ ok: true; data: T } | { ok: false; mensagem: string | null }> {
  try {
    const r = await fetch(url, {
      method: metodo,
      cache: "no-store",
      ...(corpo === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }),
    });
    const lido = ((await r.json().catch(() => ({}))) ?? {}) as Resposta<T>;
    return r.ok ? { ok: true, data: lido.data as T } : { ok: false, mensagem: lido.error?.message ?? null };
  } catch {
    return { ok: false, mensagem: null };
  }
}

function Passos({ etapa }: { etapa: EtapaPublica }) {
  const t = useT();
  const ordem: Record<EtapaPublica, number> = { termo: 0, conectar: 1, numero_diferente: 1, lendo: 2, pronto: 3, vencido: 0 };
  const agora = ordem[etapa];
  const itens = [t("1 · autorizar"), t("2 · conectar"), t("3 · pronto")];
  return (
    <ol className="flex flex-wrap gap-2 text-xs" aria-label={t("Etapas")}>
      {itens.map((rotulo, i) => (
        <li
          key={rotulo}
          aria-current={i === Math.min(agora, 2) ? "step" : undefined}
          className={`rounded-full px-3 py-1 ${i < agora ? "bg-success-bg text-success-fg" : i === Math.min(agora, 2) ? "bg-primary text-primary-foreground" : "bg-surface-elevated text-text-muted"}`}
        >
          {rotulo}
        </li>
      ))}
    </ol>
  );
}

export function ConexaoDoDono({ codigo, inicial }: { codigo: string; inicial: SituacaoPublica }) {
  const t = useT();
  const [s, setS] = useState<SituacaoPublica>(inicial);
  const [nome, setNome] = useState("");
  const [aceite, setAceite] = useState(false);
  const [forma, setForma] = useState<"codigo" | "qr">("codigo");
  const [codigoDoWhatsapp, setCodigoDoWhatsapp] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rodadaDoQr, setRodadaDoQr] = useState(0);
  const base = `/api/v1/publico/raio-x/${codigo}`;

  const atualizar = useCallback(async () => {
    const r = await pedir<SituacaoPublica>(base, "GET");
    if (r.ok) setS((anterior) => ({ ...r.data, termo: anterior.termo }));
  }, [base]);

  // Enquanto espera o pareamento ou a leitura, pergunta o andamento de tempos em tempos.
  useEffect(() => {
    if (s.etapa !== "conectar" && s.etapa !== "numero_diferente" && s.etapa !== "lendo") return;
    const id = window.setInterval(() => void atualizar(), INTERVALO_DO_ANDAMENTO_MS);
    return () => window.clearInterval(id);
  }, [s.etapa, atualizar]);

  useEffect(() => {
    if (forma !== "qr" || (s.etapa !== "conectar" && s.etapa !== "numero_diferente")) return;
    const id = window.setInterval(() => setRodadaDoQr((n) => n + 1), INTERVALO_DO_QR_MS);
    return () => window.clearInterval(id);
  }, [forma, s.etapa]);

  async function autorizar() {
    setErro(null);
    setOcupado(true);
    const r = await pedir<{ aceito: boolean }>(`${base}/aceite`, "POST", { nome: nome.trim(), aceito: true });
    setOcupado(false);
    if (!r.ok) {
      setErro(r.mensagem ?? t("Não deu para registrar a autorização. Tente de novo."));
      return;
    }
    setS((x) => ({ ...x, etapa: "conectar" }));
  }

  async function gerarCodigo() {
    setErro(null);
    setOcupado(true);
    const r = await pedir<{ codigo: string }>(`${base}/codigo`, "POST", {});
    setOcupado(false);
    if (!r.ok) {
      setErro(r.mensagem ?? t("O WhatsApp não gerou o código agora. Tente de novo ou use o QR."));
      return;
    }
    setCodigoDoWhatsapp(r.data.codigo);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-5 bg-bg px-4 py-8 text-text">
      <Passos etapa={s.etapa} />

      {s.etapa === "vencido" ? (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-6" data-raio-x-etapa="vencido">
          <h1 className="text-xl font-semibold">{t("Este link venceu")}</h1>
          <p className="text-sm text-text-muted">{t("O link de conexão vale 48 horas. Peça um novo à Time Company.")}</p>
        </section>
      ) : null}

      {s.etapa === "termo" ? (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-6" data-raio-x-etapa="termo">
          <h1 className="text-xl font-semibold">{t("Raio-X do atendimento da {empresa}").replace("{empresa}", s.empresa)}</h1>
          <p className="text-sm text-text-muted">
            {t("A Time Company vai ler as conversas do WhatsApp comercial da sua empresa para medir como está o atendimento: quanto tempo leva para responder, quem fica sem resposta e de onde vêm os clientes. Você recebe um relatório com o que melhorar.")}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              <b>{t("Só leitura.")}</b> {t("Nenhuma mensagem é enviada do seu número.")}
            </li>
            <li>
              <b>{t("Últimos {n} dias").replace("{n}", String(s.periodoDias))}</b> {t("de conversa, e o que chegar até o relatório ficar pronto.")}
            </li>
            <li>
              <b>{t("Você desconecta quando quiser,")}</b> {t("em WhatsApp › Aparelhos conectados.")}{" "}
              {s.tipo === "unico" ? t("A conexão também cai sozinha 7 dias depois do relatório.") : t("No acompanhamento mensal, a conexão fica até alguém encerrar.")}
            </li>
            <li>
              <b>{t("As conversas são apagadas")}</b>{" "}
              {t("30 dias depois do relatório. O relatório fica guardado, sem o telefone dos seus clientes, para comparar com o próximo raio-X.")}
            </li>
          </ul>
          <details className="rounded-md border border-border bg-surface-elevated p-3 text-sm">
            <summary className="cursor-pointer font-medium">{t("Ler o termo de autorização inteiro")}</summary>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed" data-raio-x="termo">
              {s.termo}
            </pre>
          </details>
          <div className="space-y-1">
            <Label htmlFor="raio-x-nome">{t("Seu nome")}</Label>
            <Input id="raio-x-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={t("Nome de quem autoriza")} autoComplete="name" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={aceite} onChange={(e) => setAceite(e.target.checked)} data-raio-x="aceite" />
            <span>
              {t("Sou responsável pelo WhatsApp {numero} e autorizo a Time Company a ler as conversas dele pelo período acima, só para analisar o atendimento, conforme o termo de autorização.").replace(
                "{numero}",
                s.whatsapp,
              )}
            </span>
          </label>
          {erro ? <p className="text-sm text-error-fg">{erro}</p> : null}
          <Button type="button" onClick={autorizar} disabled={!aceite || nome.trim().length < 2 || ocupado} data-raio-x="autorizar">
            {t("Autorizar e conectar")}
          </Button>
          <p className="text-xs text-text-muted">{t("O aceite fica registrado com o seu nome, a data, a hora e a versão do termo.")}</p>
        </section>
      ) : null}

      {s.etapa === "conectar" || s.etapa === "numero_diferente" ? (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-6" data-raio-x-etapa="conectar">
          <h1 className="text-xl font-semibold">{t("Conecte o WhatsApp comercial")}</h1>
          {s.etapa === "numero_diferente" ? (
            <p className="rounded-md bg-error-bg p-3 text-sm text-error-fg">
              {t("O WhatsApp conectado não era o {numero}. Nada foi lido. Conecte pelo celular desse número.").replace("{numero}", s.whatsapp)}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={forma === "codigo" ? "default" : "outline"} onClick={() => setForma("codigo")} aria-pressed={forma === "codigo"}>
              {t("Pelo celular")}
            </Button>
            <Button type="button" variant={forma === "qr" ? "default" : "outline"} onClick={() => setForma("qr")} aria-pressed={forma === "qr"}>
              {t("Pelo computador")}
            </Button>
          </div>
          {forma === "codigo" ? (
            <div className="space-y-3">
              {codigoDoWhatsapp ? (
                <p className="text-center font-mono text-3xl font-semibold tracking-widest" data-raio-x="codigo-do-whatsapp">
                  {codigoDoWhatsapp}
                </p>
              ) : null}
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>{t("Abra o WhatsApp no celular do número {numero}.").replace("{numero}", s.whatsapp)}</li>
                <li>{t("Toque em Configurações (no Android, nos três pontinhos) e depois em Aparelhos conectados.")}</li>
                <li>{t("Toque em Conectar aparelho e depois em Conectar com número de telefone.")}</li>
                <li>{t("Digite o código que aparece aqui.")}</li>
              </ol>
              <Button type="button" onClick={gerarCodigo} disabled={ocupado} data-raio-x="gerar-codigo">
                {codigoDoWhatsapp ? t("Gerar outro código") : t("Gerar o código")}
              </Button>
              <p className="text-xs text-text-muted">{t("O código vale por cerca de 3 minutos. Se vencer, gere outro.")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- imagem gerada na hora pelo servidor, sem otimização */}
              <img
                src={`${base}/qr?rodada=${rodadaDoQr}`}
                alt={t("QR para conectar o WhatsApp")}
                width={220}
                height={220}
                className="mx-auto rounded-md border border-border bg-white p-2"
              />
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>{t("No celular do número, abra o WhatsApp.")}</li>
                <li>{t("Toque em Configurações › Aparelhos conectados › Conectar aparelho.")}</li>
                <li>{t("Aponte a câmera para o QR.")}</li>
              </ol>
              <p className="text-xs text-text-muted">{t("O QR se renova sozinho a cada 20 segundos.")}</p>
            </div>
          )}
          {erro ? <p className="text-sm text-error-fg">{erro}</p> : null}
          <p className="text-sm text-text-muted" aria-live="polite">
            {t("Aguardando a conexão…")}
          </p>
        </section>
      ) : null}

      {s.etapa === "lendo" ? (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-6" data-raio-x-etapa="lendo">
          <h1 className="text-xl font-semibold">{t("Conectado. Lendo as conversas dos últimos {n} dias").replace("{n}", String(s.periodoDias))}</h1>
          <div className="h-2 overflow-hidden rounded-full bg-surface-elevated" role="progressbar" aria-valuenow={s.percentual ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <span className="block h-2 rounded-full bg-primary" style={{ width: `${s.percentual ?? 0}%` }} />
          </div>
          <p className="text-sm text-text-muted" aria-live="polite">
            {s.sincronizando
              ? t("O WhatsApp está mandando o histórico em partes. Isso leva alguns minutos.")
              : t("{p}% · {n} conversas lidas.").replace("{p}", String(s.percentual ?? 0)).replace("{n}", String(s.conversasLidas))}{" "}
            {t("Pode fechar esta página: a leitura continua sozinha.")}
          </p>
          <p className="text-sm text-text-muted">
            {t("No seu celular aparece \"Raio-X Time Company\" na lista de aparelhos conectados. O WhatsApp continua funcionando normal para você.")}
          </p>
        </section>
      ) : null}

      {s.etapa === "pronto" ? (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-6 text-center" data-raio-x-etapa="pronto">
          <h1 className="text-xl font-semibold">{t("Pronto. Recebemos as conversas")}</h1>
          <p className="text-sm text-text-muted">
            {t("A Time vai preparar o relatório e mandar o link para você. Se quiser desconectar antes: WhatsApp › Aparelhos conectados › Raio-X Time Company › Desconectar.")}
          </p>
        </section>
      ) : null}
    </main>
  );
}
