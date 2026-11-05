"use client";

/**
 * FORK MIA (.101) · Admin › Raio-X do atendimento: a lista e o "Novo raio-X"
 * (protótipo, telas 1 e 2). Criar devolve o link de conexão (48 h) e a mensagem
 * pronta para mandar ao dono. A escrita passa pela rota com a verificação em
 * duas etapas.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { gravar } from "@/components/admin/parceiros/chamada";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import type { RaioXNaLista } from "@/lib/raio-x/banco";
import { ROTULO_DO_SEGMENTO } from "@/lib/raio-x/segmentos";
import { SEGMENTOS } from "@/lib/raio-x/regras";

import { ROTULO_DA_SITUACAO, ROTULO_DE_QUEM_ATENDE, ROTULO_DO_TIPO } from "./rotulos";

const SELECT = "h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

export interface EmpresaDaMia {
  id: string;
  nome: string;
}

interface Rascunho {
  empresa: string;
  segmento: string;
  whatsapp: string;
  responsavel_nome: string;
  responsavel_contato: string;
  quem_atende: "humano" | "agente" | "misto";
  periodo_dias: "30" | "60" | "90";
  tipo: "unico" | "mensal";
  abre: string;
  fecha: string;
  sabado: "sim" | "nao";
  sabado_ate: string;
  organization_id: string;
  teto_reais: string;
}

const VAZIO: Rascunho = {
  empresa: "",
  segmento: "revenda_de_veiculos",
  whatsapp: "",
  responsavel_nome: "",
  responsavel_contato: "",
  quem_atende: "humano",
  periodo_dias: "90",
  tipo: "unico",
  abre: "08:00",
  fecha: "18:00",
  sabado: "sim",
  sabado_ate: "13:00",
  organization_id: "",
  teto_reais: "40",
};

interface Criado {
  id: string;
  link: string;
  expira_em: string;
  mensagem: string;
}

export function RaioXDaTime({ lista, empresas }: { lista: RaioXNaLista[]; empresas: EmpresaDaMia[] }) {
  const t = useT();
  const tag = tagDeIdioma(useIdioma());
  const router = useRouter();
  const [abrindo, setAbrindo] = useState(false);
  const [r, setR] = useState<Rascunho>(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [criado, setCriado] = useState<Criado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const data = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "·";
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((x) => ({ ...x, [k]: v }));

  async function criar() {
    setErro(null);
    if (!r.empresa.trim() || !r.whatsapp.trim()) {
      setErro(t("Preencha pelo menos a empresa e o WhatsApp comercial."));
      return;
    }
    setSalvando(true);
    const teto = Math.round(Number(r.teto_reais.replace(",", ".")) * 100);
    const resposta = await gravar<Criado>(
      "/api/v1/admin/raio-x",
      "POST",
      {
        empresa: r.empresa,
        segmento: r.segmento,
        whatsapp: r.whatsapp,
        responsavel_nome: r.responsavel_nome || null,
        responsavel_contato: r.responsavel_contato || null,
        quem_atende: r.quem_atende,
        periodo_dias: Number(r.periodo_dias),
        tipo: r.tipo,
        abre: r.abre,
        fecha: r.fecha,
        sabado_ate: r.sabado === "sim" ? r.sabado_ate : null,
        organization_id: r.organization_id || null,
        teto_centavos: Number.isFinite(teto) ? teto : 4000,
      },
      t,
    );
    setSalvando(false);
    if (!resposta.ok) {
      setErro(resposta.mensagem);
      return;
    }
    setCriado(resposta.data);
    toast.success(t("Raio-X criado. O link vale 48 horas."));
    router.refresh();
  }

  async function copiar(texto: string, aviso: string) {
    const ok = await copyToClipboard(texto);
    if (ok) toast.success(aviso);
    else toast.error(t("Não deu para copiar aqui. Selecione o texto e copie."));
  }

  const contar = (s: string) => lista.filter((x) => x.situacao === s).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          [String(lista.length), t("raio-X criados")],
          [String(contar("aguardando") + contar("conectando")), t("aguardando conexão")],
          [String(contar("lendo") + contar("analisando")), t("lendo ou analisando")],
          [String(contar("pronto")), t("relatório pronto")],
          [String(lista.reduce((s, x) => s + x.conversas, 0)), t("conversas lidas")],
        ].map(([v, rotulo]) => (
          <div key={rotulo} className="rounded-lg border border-border bg-surface p-4">
            <div className="text-2xl font-semibold tabular-nums">{v}</div>
            <div className="text-sm text-text-muted">{rotulo}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" data-raio-x="novo" onClick={() => setAbrindo((a) => !a)}>
          {t("Novo raio-X")}
        </Button>
        <span className="text-sm text-text-muted">{t("Só a equipe da Time vê esta tela.")}</span>
      </div>

      {abrindo ? (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-base font-semibold">{t("Dados do raio-X")}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="raio-x-empresa">{t("Empresa")}</Label>
              <Input id="raio-x-empresa" value={r.empresa} onChange={(e) => set("empresa", e.target.value)} placeholder={t("Ex.: Garagem Modelo Veículos")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-segmento">{t("Segmento")}</Label>
              <select id="raio-x-segmento" className={SELECT} value={r.segmento} onChange={(e) => set("segmento", e.target.value)}>
                {SEGMENTOS.map((s) => (
                  <option key={s} value={s}>
                    {t(ROTULO_DO_SEGMENTO[s])}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-muted">{t("Define o que o relatório procura nas conversas.")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-whatsapp">{t("WhatsApp comercial")}</Label>
              <Input id="raio-x-whatsapp" value={r.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="(31) 90000-0000" />
              <p className="text-xs text-text-muted">{t("O número que vai ser analisado. Precisa ser o aplicativo do WhatsApp (comum ou Business).")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-responsavel">{t("Quem autoriza")}</Label>
              <Input id="raio-x-responsavel" value={r.responsavel_nome} onChange={(e) => set("responsavel_nome", e.target.value)} placeholder={t("Nome do dono ou responsável")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-contato">{t("Contato de quem autoriza")}</Label>
              <Input id="raio-x-contato" value={r.responsavel_contato} onChange={(e) => set("responsavel_contato", e.target.value)} placeholder={t("WhatsApp ou e-mail")} />
              <p className="text-xs text-text-muted">{t("Recebe o link de conexão e, depois, o link do relatório.")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-atende">{t("Quem atende hoje")}</Label>
              <select id="raio-x-atende" className={SELECT} value={r.quem_atende} onChange={(e) => set("quem_atende", e.target.value as Rascunho["quem_atende"])}>
                <option value="humano">{t(ROTULO_DE_QUEM_ATENDE.humano)}</option>
                <option value="agente">{t(ROTULO_DE_QUEM_ATENDE.agente)}</option>
                <option value="misto">{t(ROTULO_DE_QUEM_ATENDE.misto)}</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-periodo">{t("Período a ler")}</Label>
              <select id="raio-x-periodo" className={SELECT} value={r.periodo_dias} onChange={(e) => set("periodo_dias", e.target.value as Rascunho["periodo_dias"])}>
                <option value="30">{t("Últimos 30 dias")}</option>
                <option value="60">{t("Últimos 60 dias")}</option>
                <option value="90">{t("Últimos 90 dias")}</option>
              </select>
              <p className="text-xs text-text-muted">{t("O WhatsApp entrega cerca de 3 meses de histórico.")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-tipo">{t("Tipo")}</Label>
              <select id="raio-x-tipo" className={SELECT} value={r.tipo} onChange={(e) => set("tipo", e.target.value as Rascunho["tipo"])}>
                <option value="unico">{t("Diagnóstico único · conecta, lê, gera o relatório e desconecta em 7 dias")}</option>
                <option value="mensal">{t("Acompanhamento mensal · fica conectado e gera um relatório por mês")}</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-abre">{t("Horário comercial")}</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input id="raio-x-abre" type="time" value={r.abre} onChange={(e) => set("abre", e.target.value)} aria-label={t("Abre às")} />
                <Input id="raio-x-fecha" type="time" value={r.fecha} onChange={(e) => set("fecha", e.target.value)} aria-label={t("Fecha às")} />
              </div>
              <p className="text-xs text-text-muted">{t("Separa o que chegou com a loja aberta e fechada.")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-sabado">{t("Abre no sábado?")}</Label>
              <div className="grid grid-cols-2 gap-2">
                <select id="raio-x-sabado" className={SELECT} value={r.sabado} onChange={(e) => set("sabado", e.target.value as Rascunho["sabado"])}>
                  <option value="sim">{t("Sim, até")}</option>
                  <option value="nao">{t("Não")}</option>
                </select>
                <Input type="time" value={r.sabado_ate} disabled={r.sabado === "nao"} onChange={(e) => set("sabado_ate", e.target.value)} aria-label={t("Até que horas no sábado")} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-empresa-da-mia">{t("Empresa da MIA (opcional)")}</Label>
              <select id="raio-x-empresa-da-mia" className={SELECT} value={r.organization_id} onChange={(e) => set("organization_id", e.target.value)}>
                <option value="">{t("Ainda não é cliente")}</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-muted">{t("Liga o raio-X à conta da MIA, quando a empresa já é cliente. Dá para ligar depois.")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-teto">{t("Teto de custo da análise (R$)")}</Label>
              <Input id="raio-x-teto" inputMode="decimal" value={r.teto_reais} onChange={(e) => set("teto_reais", e.target.value)} />
              <p className="text-xs text-text-muted">{t("Ao bater o teto, a análise para e o relatório diz o que ficou de fora. Padrão R$ 40.")}</p>
            </div>
          </div>
          {erro ? <p className="text-sm text-error-fg">{erro}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" data-raio-x="criar" onClick={criar} disabled={salvando}>
              {salvando ? t("Criando…") : t("Criar e gerar o link")}
            </Button>
            <span className="text-sm text-text-muted">{t("O link vale 48 horas. Depois disso dá para gerar outro no detalhe.")}</span>
          </div>
        </section>
      ) : null}

      {criado ? (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5" data-raio-x="link-pronto">
          <h2 className="text-base font-semibold">{t("Link pronto")}</h2>
          <p className="rounded-md bg-success-bg p-3 text-sm text-success-fg">{t("Raio-X criado. Agora é só mandar o link para o dono.")}</p>
          <div className="flex flex-wrap gap-2">
            <Input readOnly value={criado.link} className="flex-1" data-raio-x="link-de-conexao" aria-label={t("Link de conexão")} />
            <Button type="button" variant="outline" onClick={() => copiar(criado.link, t("Link copiado."))}>
              {t("Copiar")}
            </Button>
          </div>
          <pre className="whitespace-pre-wrap rounded-md border border-border bg-surface-elevated p-3 text-sm" data-raio-x="mensagem-pronta">
            {criado.mensagem}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => copiar(criado.mensagem, t("Mensagem copiada. É só colar no WhatsApp do cliente."))}>
              {t("Copiar a mensagem")}
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/raio-x/${criado.id}`}>{t("Abrir o raio-X")}</Link>
            </Button>
          </div>
        </section>
      ) : null}

      <section className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="p-3 font-medium">{t("Empresa")}</th>
              <th className="p-3 font-medium">{t("WhatsApp comercial")}</th>
              <th className="p-3 font-medium">{t("Tipo")}</th>
              <th className="p-3 font-medium">{t("Situação")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-text-muted">
                  {t("Nenhum raio-X ainda. Comece pelo Novo raio-X.")}
                </td>
              </tr>
            ) : null}
            {lista.map((x) => (
              <tr key={x.id} className="border-t border-border align-top" data-raio-x-linha={x.empresa}>
                <td className="p-3">
                  <b>{x.empresa}</b>
                  <div className="text-xs text-text-muted">{t(ROTULO_DO_SEGMENTO[x.segmento as keyof typeof ROTULO_DO_SEGMENTO] ?? ROTULO_DO_SEGMENTO.outro)}</div>
                </td>
                <td className="p-3 font-mono text-xs">{x.whatsappParaLer}</td>
                <td className="p-3">
                  {t(ROTULO_DO_TIPO[x.tipo])}
                  <div className="text-xs text-text-muted">
                    {t("criado em")} {data(x.criadoEm)}
                  </div>
                  {x.anterior ? (
                    <div className="text-xs text-text-muted">
                      {t("o anterior da mesma empresa é de")} {data(x.anterior.criadoEm)}
                    </div>
                  ) : null}
                </td>
                <td className="p-3">
                  <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-xs" data-raio-x-situacao={x.situacao}>
                    {t(ROTULO_DA_SITUACAO[x.situacao])}
                    {x.situacao === "lendo" && x.andamento !== null ? ` · ${x.andamento}%` : ""}
                  </span>
                  {(x.situacao === "aguardando" || x.situacao === "conectando") && !x.linkVivo ? (
                    <div className="text-xs text-error-fg">{t("o link venceu")}</div>
                  ) : null}
                  {x.desconectarEm && !x.desconectadoEm ? (
                    <div className="text-xs text-text-muted">
                      {t("conexão cai em")} {data(x.desconectarEm)}
                    </div>
                  ) : null}
                  {x.conversasApagadasEm ? (
                    <div className="text-xs text-text-muted">
                      {t("conversas apagadas em")} {data(x.conversasApagadasEm)}
                    </div>
                  ) : x.apagarConversasEm ? (
                    <div className="text-xs text-text-muted">
                      {t("conversas apagam em")} {data(x.apagarConversasEm)}
                    </div>
                  ) : null}
                </td>
                <td className="p-3">
                  <Button asChild size="sm" variant={x.ultimoRelatorio ? "default" : "outline"}>
                    <Link href={`/admin/raio-x/${x.id}`}>{x.ultimoRelatorio ? t("Ver relatório") : t("Acompanhar")}</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
