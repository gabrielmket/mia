"use client";

/**
 * FORK MIA (.101) · As ações do detalhe do raio-X (protótipo, telas 1 e 4):
 * copiar ou gerar outro link de conexão, revisar o rascunho, gerar e revogar o
 * link do dono, ligar a empresa da MIA, mudar o teto, desconectar agora e
 * encerrar. Cada uma passa pela rota de admin com a verificação em duas etapas.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { gravar } from "@/components/admin/parceiros/chamada";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import type { LinkDoDono } from "@/lib/raio-x/banco";

import { ROTULO_DA_SITUACAO_DO_LINK } from "./rotulos";

const SELECT = "h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

async function excluir(url: string, corpo: unknown, t: (s: string) => string) {
  try {
    const r = await fetch(url, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const lido = ((await r.json().catch(() => ({}))) ?? {}) as { error?: { message?: string } };
    return r.ok ? { ok: true as const } : { ok: false as const, mensagem: lido.error?.message ?? t("Não foi possível salvar. Tente de novo.") };
  } catch {
    return { ok: false as const, mensagem: t("Não deu para falar com o servidor. Confira a conexão e tente de novo.") };
  }
}

export function ConexaoDoRaioX({
  raioXId,
  link,
  mensagem,
  vivo,
  expiraEm,
  autorizacao = false,
}: {
  raioXId: string;
  link: string;
  mensagem: string;
  vivo: boolean;
  expiraEm: string | null;
  /** FORK MIA (.102): no cliente ativo o link é só de AUTORIZAÇÃO (nada é conectado). */
  autorizacao?: boolean;
}) {
  const t = useT();
  const tag = tagDeIdioma(useIdioma());
  const router = useRouter();
  const [atual, setAtual] = useState({ link, mensagem, vivo, expiraEm });
  const [gerando, setGerando] = useState(false);

  async function copiar(texto: string, aviso: string) {
    if (await copyToClipboard(texto)) toast.success(aviso);
    else toast.error(t("Não deu para copiar aqui. Selecione o texto e copie."));
  }

  async function gerarOutro() {
    setGerando(true);
    const r = await gravar<{ link: string; expira_em: string; mensagem: string }>(`/api/v1/admin/raio-x/${raioXId}/link-de-conexao`, "POST", {}, t);
    setGerando(false);
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    setAtual({ link: r.data.link, mensagem: r.data.mensagem, vivo: true, expiraEm: r.data.expira_em });
    toast.success(t("Link novo gerado. O anterior deixou de valer, e este vale 48 horas."));
    router.refresh();
  }

  const ate = atual.expiraEm
    ? new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(atual.expiraEm))
    : "·";

  return (
    <div className="space-y-3" data-raio-x="conexao">
      <div className="flex flex-wrap gap-2">
        <Input readOnly value={atual.link} className="flex-1" aria-label={autorizacao ? t("Link de autorização") : t("Link de conexão")} data-raio-x="link-de-conexao" />
        <Button type="button" variant="outline" onClick={() => copiar(atual.link, t("Link copiado."))} disabled={!atual.vivo}>
          {t("Copiar o link")}
        </Button>
        <Button type="button" variant="outline" onClick={() => copiar(atual.mensagem, t("Mensagem copiada. É só colar no WhatsApp do cliente."))} disabled={!atual.vivo}>
          {t("Copiar a mensagem")}
        </Button>
        <Button type="button" variant="outline" onClick={gerarOutro} disabled={gerando} data-raio-x="gerar-outro-link">
          {t("Gerar outro link")}
        </Button>
      </div>
      <p className={`text-xs ${atual.vivo ? "text-text-muted" : "text-error-fg"}`}>
        {atual.vivo ? `${t("O link vale até")} ${ate}.` : t("O link venceu. Gere outro para mandar ao dono.")}
      </p>
    </div>
  );
}

export function RevisaoDoRelatorio({
  raioXId,
  relatorioId,
  revisado,
  notas,
  links,
}: {
  raioXId: string;
  relatorioId: string;
  revisado: boolean;
  notas: string | null;
  links: LinkDoDono[];
}) {
  const t = useT();
  const tag = tagDeIdioma(useIdioma());
  const router = useRouter();
  const [texto, setTexto] = useState(notas ?? "");
  const [dias, setDias] = useState<"7" | "30" | "90">("30");
  const [ocupado, setOcupado] = useState(false);

  async function revisar() {
    setOcupado(true);
    const r = await gravar(`/api/v1/admin/raio-x/${raioXId}/relatorio`, "POST", { relatorio_id: relatorioId, notas: texto || null }, t);
    setOcupado(false);
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    toast.success(t("Relatório marcado como revisado."));
    router.refresh();
  }

  async function gerarLink() {
    setOcupado(true);
    const r = await gravar<{ link: LinkDoDono }>(`/api/v1/admin/raio-x/${raioXId}/link-do-dono`, "POST", { relatorio_id: relatorioId, dias: Number(dias) }, t);
    setOcupado(false);
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    if (await copyToClipboard(r.data.link.url)) toast.success(t("Link do dono gerado e copiado."));
    else toast.success(t("Link do dono gerado."));
    router.refresh();
  }

  async function revogar(linkId: string) {
    setOcupado(true);
    const r = await excluir(`/api/v1/admin/raio-x/${raioXId}/link-do-dono`, { link_id: linkId }, t);
    setOcupado(false);
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    toast.success(t("Link desligado. Quem abrir vê que não está disponível."));
    router.refresh();
  }

  const data = (iso: string) => new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

  return (
    <div className="space-y-4" data-raio-x="revisao">
      <div className="space-y-1">
        <Label htmlFor="raio-x-notas">{t("Anotações da revisão (o dono não vê)")}</Label>
        <Textarea id="raio-x-notas" value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={revisar} disabled={ocupado} variant={revisado ? "outline" : "default"} data-raio-x="revisar">
          {revisado ? t("Salvar as anotações") : t("Marcar como revisado")}
        </Button>
        {revisado ? (
          <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs text-success-fg">{t("revisado")}</span>
        ) : (
          <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning-fg">{t("rascunho: o link do dono só sai depois da revisão")}</span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="raio-x-validade">{t("Validade do link do dono")}</Label>
          <select id="raio-x-validade" className={SELECT} value={dias} onChange={(e) => setDias(e.target.value as "7" | "30" | "90")}>
            <option value="7">{t("7 dias")}</option>
            <option value="30">{t("30 dias")}</option>
            <option value="90">{t("90 dias")}</option>
          </select>
        </div>
        <Button type="button" onClick={gerarLink} disabled={ocupado || !revisado} data-raio-x="gerar-link-do-dono">
          {t("Gerar o link para o dono")}
        </Button>
      </div>
      {links.length > 0 ? (
        <ul className="space-y-2 text-sm" data-raio-x="links-do-dono">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
              <Input readOnly value={l.url} className="min-w-0 flex-1" aria-label={t("Link do dono")} data-raio-x-link-do-dono={l.situacao} />
              <span className="text-xs text-text-muted">
                {t(ROTULO_DA_SITUACAO_DO_LINK[l.situacao])} · {t("até")} {data(l.validoAte)} · {l.acessos} {t("acessos")}
              </span>
              {l.situacao === "ativo" ? (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={async () => ((await copyToClipboard(l.url)) ? toast.success(t("Link copiado.")) : undefined)}>
                    {t("Copiar")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => revogar(l.id)} disabled={ocupado}>
                    {t("Desligar")}
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AjustesDoRaioX({
  raioXId,
  encerrado,
  conectado,
  podeLerDeNovo = false,
  organizationId,
  tetoCentavos,
  empresas,
}: {
  raioXId: string;
  encerrado: boolean;
  conectado: boolean;
  /** FORK MIA (.105): pronto, pela conexão, conectado e sem relatório revisado no período. */
  podeLerDeNovo?: boolean;
  organizationId: string | null;
  tetoCentavos: number;
  empresas: Array<{ id: string; nome: string }>;
}) {
  const t = useT();
  const router = useRouter();
  const [org, setOrg] = useState(organizationId ?? "");
  const [teto, setTeto] = useState(String(tetoCentavos / 100));
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setOcupado(true);
    const centavos = Math.round(Number(teto.replace(",", ".")) * 100);
    const r = await gravar(`/api/v1/admin/raio-x/${raioXId}`, "PATCH", { organization_id: org || null, teto_centavos: centavos }, t);
    setOcupado(false);
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    toast.success(t("Salvo."));
    router.refresh();
  }

  async function acao(caminho: "desconectar" | "encerrar" | "ler-de-novo", pergunta: string, feito: string) {
    if (!window.confirm(pergunta)) return;
    setOcupado(true);
    const r = await gravar(`/api/v1/admin/raio-x/${raioXId}/${caminho}`, "POST", {}, t);
    setOcupado(false);
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    toast.success(feito);
    router.refresh();
  }

  return (
    <div className="space-y-4" data-raio-x="ajustes">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="raio-x-ligar-empresa">{t("Empresa da MIA")}</Label>
          <select id="raio-x-ligar-empresa" className={SELECT} value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">{t("Ainda não é cliente")}</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="raio-x-mudar-teto">{t("Teto de custo da análise (R$)")}</Label>
          <Input id="raio-x-mudar-teto" inputMode="decimal" value={teto} onChange={(e) => setTeto(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={salvar} disabled={ocupado}>
          {t("Salvar")}
        </Button>
        {podeLerDeNovo ? (
          <Button
            type="button"
            variant="outline"
            disabled={ocupado}
            data-raio-x="ler-de-novo"
            onClick={() =>
              acao(
                "ler-de-novo",
                t("Ler de novo? O rascunho deste período sai e as conversas do WhatsApp conectado são lidas outra vez (sem pedir nada ao dono). Depois vem um rascunho novo."),
                t("Lendo de novo. O andamento aparece aqui em alguns minutos."),
              )
            }
          >
            {t("Ler de novo")}
          </Button>
        ) : null}
        {!encerrado && conectado ? (
          <Button
            type="button"
            variant="outline"
            disabled={ocupado}
            data-raio-x="desconectar"
            onClick={() =>
              acao(
                "desconectar",
                t("Desconectar agora? A conexão cai agora e as conversas são apagadas em 30 dias. O relatório fica."),
                t("Desconectado. As conversas apagam no prazo; o relatório fica."),
              )
            }
          >
            {t("Desconectar agora")}
          </Button>
        ) : null}
        {!encerrado ? (
          <Button
            type="button"
            variant="destructive"
            disabled={ocupado}
            data-raio-x="encerrar"
            onClick={() =>
              acao(
                "encerrar",
                t("Encerrar este raio-X? A conexão cai, a leitura para e as conversas são apagadas em 30 dias. O relatório fica guardado."),
                t("Raio-X encerrado."),
              )
            }
          >
            {t("Encerrar")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
