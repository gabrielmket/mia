"use client";

/**
 * FORK MIA (.107) · AS PEÇAS DE TELA DA ÁREA DO RAIO-X (protótipo de
 * 06/11/2026, telas 5, 6 e 8): entrar com o código no e-mail, sair, conectar e
 * desconectar o número, e pedir a nova análise. A identidade é o cookie da
 * sessão (o servidor confere em cada rota); estas peças só chamam as rotas.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";

interface Resposta<T> {
  data?: T;
  error?: { message?: string; details?: Record<string, unknown> };
}

async function postar<T>(url: string, corpo: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; mensagem: string | null; detalhes?: Record<string, unknown> }> {
  try {
    const r = await fetch(url, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const lido = ((await r.json().catch(() => ({}))) ?? {}) as Resposta<T>;
    return r.ok ? { ok: true, data: lido.data as T } : { ok: false, status: r.status, mensagem: lido.error?.message ?? null, detalhes: lido.error?.details };
  } catch {
    return { ok: false, status: 0, mensagem: null };
  }
}

// ─── Entrar (tela 5) ────────────────────────────────────────────────────────

export function EntrarNaArea({ emailInicial, jaUsou }: { emailInicial: string; jaUsou: boolean }) {
  const t = useT();
  const [email, setEmail] = useState(emailInicial);
  const [codigo, setCodigo] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function mandarCodigo() {
    setErro(null);
    setOcupado(true);
    const r = await postar<{ enviado: boolean }>("/api/v1/publico/raio-x/entrar", { email });
    setOcupado(false);
    if (!r.ok) {
      setErro(r.mensagem ?? t("Não deu para mandar o código agora. Tente de novo."));
      return;
    }
    setEnviado(true);
  }

  async function confirmar() {
    setErro(null);
    setOcupado(true);
    const r = await postar<{ destino: string }>("/api/v1/publico/raio-x/entrar/confirmar", { email, codigo });
    setOcupado(false);
    if (!r.ok) {
      setErro(r.mensagem ?? t("Não deu para entrar agora. Tente de novo."));
      return;
    }
    window.location.assign(r.data.destino || "/raio-x/minha-area");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-5 bg-bg px-4 py-8 text-text">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("Entrar na área do Raio-X")}</h1>
        <p className="text-sm text-text-muted">{t("Sem senha: mandamos um código de 6 números para o e-mail do cadastro.")}</p>
      </header>
      {jaUsou ? (
        <p className="rounded-md border border-border bg-surface-elevated p-3 text-sm" data-raio-x="ja-usou">
          {t("A análise grátis deste número (ou deste e-mail) já foi usada. Entre para ver o seu Raio-X ou pedir uma nova análise.")}
        </p>
      ) : null}
      <section className="space-y-4 rounded-lg border border-border bg-surface p-6">
        <div className="space-y-1">
          <Label htmlFor="raio-x-entrar-email">{t("E-mail")}</Label>
          <Input id="raio-x-entrar-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button type="button" onClick={mandarCodigo} disabled={ocupado || email.trim().length < 6} data-raio-x="mandar-codigo">
          {enviado ? t("Mandar outro código") : t("Mandar o código")}
        </Button>
        {enviado ? (
          <div className="space-y-3" data-raio-x="codigo-enviado">
            <p className="rounded-md bg-success-bg p-3 text-sm text-success-fg">{t("Se esse e-mail tem um Raio-X, o código chegou. Ele vale por 15 minutos.")}</p>
            <div className="space-y-1">
              <Label htmlFor="raio-x-codigo">{t("Código")}</Label>
              <Input
                id="raio-x-codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                className="max-w-[180px] font-mono tracking-widest"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
            <Button type="button" onClick={confirmar} disabled={ocupado || codigo.replace(/\D/g, "").length !== 6} data-raio-x="entrar">
              {t("Entrar")}
            </Button>
          </div>
        ) : null}
        {erro ? <p className="text-sm text-error-fg">{erro}</p> : null}
        <p className="text-xs text-text-muted">
          {t("A resposta é a mesma para qualquer e-mail, para ninguém descobrir quem tem cadastro. Cinco tentativas erradas pedem um código novo.")}
        </p>
      </section>
      <p className="text-sm text-text-muted">
        {t("Ainda não tem o Raio-X?")}{" "}
        <a href="/raio-x/gratis" className="underline">
          {t("Fazer o cadastro grátis")}
        </a>
      </p>
    </main>
  );
}

// ─── Sair ───────────────────────────────────────────────────────────────────

export function BotaoDeSair() {
  const t = useT();
  async function sair() {
    await postar("/api/v1/publico/raio-x/sair", {});
    window.location.assign("/raio-x/entrar");
  }
  return (
    <button type="button" onClick={sair} className="underline" data-raio-x="sair">
      {t("sair")}
    </button>
  );
}

// ─── A conexão do número (tela 6) ───────────────────────────────────────────

export function AcoesDaConexao({ raioXId, conectado, podeConectar }: { raioXId: string; conectado: boolean; podeConectar: boolean }) {
  const t = useT();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function agir(acao: "desconectar" | "conectar") {
    if (acao === "desconectar" && !window.confirm(t("Desconectar agora? A leitura para, e o relatório que já saiu continua na sua área."))) return;
    setErro(null);
    setOcupado(true);
    const r = await postar<{ link?: string | null }>("/api/v1/publico/raio-x/minha-area/conexao", { raio_x_id: raioXId, acao });
    setOcupado(false);
    if (!r.ok) {
      setErro(r.mensagem ?? t("Não deu agora. Tente de novo."));
      return;
    }
    if (acao === "conectar" && r.data.link) window.location.assign(r.data.link);
    else window.location.reload();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {conectado ? (
          <Button type="button" size="sm" variant="outline" onClick={() => agir("desconectar")} disabled={ocupado} data-raio-x="desconectar">
            {t("Desconectar agora")}
          </Button>
        ) : null}
        {podeConectar ? (
          <Button type="button" size="sm" onClick={() => agir("conectar")} disabled={ocupado} data-raio-x="conectar">
            {t("Conectar o WhatsApp")}
          </Button>
        ) : null}
      </div>
      {erro ? <p className="text-sm text-error-fg">{erro}</p> : null}
    </div>
  );
}

// ─── A nova análise (tela 8) ────────────────────────────────────────────────

export interface PrecoNaTela {
  tipo: "avulsa" | "mensal";
  valorCentavos: number | null;
}

export function NovaAnalise({ precos, pedeDocumento, tag }: { precos: PrecoNaTela[]; pedeDocumento: boolean; tag: string }) {
  const t = useT();
  const [tipo, setTipo] = useState<"avulsa" | "mensal">("avulsa");
  const [documento, setDocumento] = useState("");
  const [aceite, setAceite] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [interesse, setInteresse] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const preco = (x: "avulsa" | "mensal") => precos.find((p) => p.tipo === x)?.valorCentavos ?? null;
  const reais = (c: number) => new Intl.NumberFormat(tag, { style: "currency", currency: "BRL" }).format(c / 100);
  const comPreco = preco(tipo) !== null;

  async function pedir() {
    setErro(null);
    if (!aceite) {
      setErro(t("Marque a autorização para continuar."));
      return;
    }
    setOcupado(true);
    const r = await postar<{ situacao: string; link_pagamento?: string | null }>("/api/v1/publico/raio-x/minha-area/nova", {
      tipo,
      aceite: true,
      ...(pedeDocumento && comPreco ? { documento } : {}),
    });
    setOcupado(false);
    if (!r.ok) {
      setErro(r.mensagem ?? t("Não deu para pedir agora. Tente de novo."));
      return;
    }
    if (r.data.situacao === "aguardando" && r.data.link_pagamento) {
      window.location.assign(r.data.link_pagamento);
      return;
    }
    setInteresse(true);
  }

  if (interesse) {
    return (
      <p className="rounded-md bg-success-bg p-4 text-sm text-success-fg" data-raio-x="pedido-interesse">
        {t("Pedido recebido. A equipe vai falar com você pelo WhatsApp do cadastro para combinar a nova análise.")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("Como seguir")}>
        {(["avulsa", "mensal"] as const).map((x) => {
          const p = preco(x);
          return (
            <label key={x} className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${tipo === x ? "border-primary bg-primary/5" : "border-border"}`}>
              <input type="radio" name="tipo" className="mt-1" checked={tipo === x} onChange={() => setTipo(x)} data-raio-x-tipo={x} />
              <span className="text-sm">
                <b className="block">
                  {x === "avulsa" ? t("Avulsa") : t("Mensal")}
                  {p !== null ? ` · ${reais(p)}${x === "mensal" ? ` ${t("por mês")}` : ""}` : ""}
                </b>
                {x === "avulsa"
                  ? t("Uma análise dos últimos 30 dias, comparada com a anterior. Paga uma vez.")
                  : t("Uma análise todo dia 1, com a evolução mês a mês. O WhatsApp fica conectado. Cancela quando quiser.")}
              </span>
            </label>
          );
        })}
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>{t("Se a conexão já caiu, você conecta de novo depois do pagamento (mesma página, mesmo QR).")}</li>
        <li>{t("A autorização vale para a nova leitura deste número; no mensal, para a leitura de todo mês, até você cancelar.")}</li>
        <li>{t("Se o histórico não chegar e a análise não sair, a equipe combina com você uma nova tentativa.")}</li>
      </ul>
      {comPreco && pedeDocumento ? (
        <div className="space-y-1">
          <Label htmlFor="raio-x-documento">{t("CPF ou CNPJ de quem paga")}</Label>
          <Input id="raio-x-documento" inputMode="numeric" value={documento} onChange={(e) => setDocumento(e.target.value)} className="max-w-xs" />
          <p className="text-xs text-text-muted">{t("O Asaas pede o documento para gerar o Pix e o boleto. Ele vai direto ao Asaas e não fica guardado aqui.")}</p>
        </div>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={aceite} onChange={(e) => setAceite(e.target.checked)} data-raio-x="aceite-nova" />
        <span>{t("Autorizo a nova leitura do mesmo número, conforme o termo de autorização do Raio-X.")}</span>
      </label>
      {erro ? <p className="text-sm text-error-fg">{erro}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={pedir} disabled={ocupado} data-raio-x="pedir-nova">
          {comPreco ? t("Ir para o pagamento") : t("Pedir a nova análise")}
        </Button>
        <span className="text-xs text-text-muted">
          {comPreco ? t("Abre o Pix ou o cartão do Asaas.") : t("Ainda sem preço por aqui: a equipe fala com você.")}
        </span>
      </div>
    </div>
  );
}
