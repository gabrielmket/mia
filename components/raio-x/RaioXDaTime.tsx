"use client";

/**
 * FORK MIA (.101) · Admin › Raio-X do atendimento: a lista e o "Novo raio-X"
 * (protótipo, telas 1 e 2). Criar devolve o link de conexão (48 h) e a mensagem
 * pronta para mandar ao dono. A escrita passa pela rota com a verificação em
 * duas etapas.
 *
 * FORK MIA (.102) · a primeira pergunta é DE ONDE VÊM AS CONVERSAS (protótipo de
 * 05/11/2026, telas 1 e 2): "Conectar o WhatsApp" é o cadastro da .101, sem
 * mudança; "Conversas que já estão na MIA" é o cliente ativo, com quase tudo
 * puxado da conta (`/api/v1/admin/raio-x/conta`): a empresa ativa, o segmento,
 * os números (inclusive da API oficial), o período limitado à primeira
 * conversa, o horário, quem autoriza e a estimativa de custo. Nada é
 * conectado: o link é só de autorização.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
import type { ContaParaORaioX } from "@/lib/raio-x/conta";
import { ROTULO_DO_SEGMENTO } from "@/lib/raio-x/segmentos";
import { SEGMENTOS, whatsappParaLer } from "@/lib/raio-x/regras";

import { ROTULO_DA_SITUACAO, ROTULO_DE_QUEM_ATENDE, ROTULO_DO_TIPO } from "./rotulos";

const SELECT = "h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
const FUSO = "America/Sao_Paulo";

export interface EmpresaDaMia {
  id: string;
  nome: string;
}

/** FORK MIA (.102): uma empresa que pode ter o raio-X do cliente ativo. */
export interface EmpresaAtivaDaMia extends EmpresaDaMia {
  clienteDesde: string;
  demonstracao: boolean;
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

/** FORK MIA (.102): o cadastro do cliente ativo começa nos 60 dias do protótipo. */
const VAZIO_DA_MIA: Rascunho = { ...VAZIO, segmento: "outro", periodo_dias: "60", quem_atende: "misto" };

interface Criado {
  id: string;
  link: string;
  expira_em: string;
  mensagem: string;
  fonte?: "conexao" | "conversas_da_mia";
}

type Fonte = "conexao" | "conversas_da_mia";

export function RaioXDaTime({ lista, empresas, ativas = [] }: { lista: RaioXNaLista[]; empresas: EmpresaDaMia[]; ativas?: EmpresaAtivaDaMia[] }) {
  const t = useT();
  const tag = tagDeIdioma(useIdioma());
  const router = useRouter();
  const [abrindo, setAbrindo] = useState(false);
  const [fonte, setFonte] = useState<Fonte>("conexao");
  const [r, setR] = useState<Rascunho>(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [criado, setCriado] = useState<Criado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // FORK MIA (.102): o que veio da conta e os números marcados.
  const [conta, setConta] = useState<ContaParaORaioX | null>(null);
  const [numeros, setNumeros] = useState<string[]>([]);
  const [lendoConta, setLendoConta] = useState(false);

  const data = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", timeZone: FUSO }).format(new Date(iso)) : "·";
  const dataLonga = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: FUSO }).format(new Date(iso)) : "·";
  /** O último dia de um período de fim exclusivo (a meia-noite de hoje). */
  const ultimoDia = (iso: string | null) => (iso ? data(new Date(Date.parse(iso) - 1).toISOString()) : "·");
  const reais = (centavos: number) => new Intl.NumberFormat(tag, { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(centavos / 100);
  const inteiro = (n: number) => new Intl.NumberFormat(tag).format(n);
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((x) => ({ ...x, [k]: v }));

  function escolherFonte(f: Fonte) {
    setFonte(f);
    setErro(null);
    setConta(null);
    setNumeros([]);
    setR(f === "conexao" ? VAZIO : VAZIO_DA_MIA);
  }

  const lerConta = useCallback(
    async (orgId: string, periodo: string, escolhidos: string[] | null) => {
      if (!orgId) {
        setConta(null);
        return;
      }
      setLendoConta(true);
      try {
        const busca = new URLSearchParams({ organization_id: orgId, periodo_dias: periodo });
        if (escolhidos) busca.set("numeros", escolhidos.join(","));
        const resposta = await fetch(`/api/v1/admin/raio-x/conta?${busca.toString()}`, { cache: "no-store", credentials: "same-origin" });
        const lido = ((await resposta.json().catch(() => ({}))) ?? {}) as { data?: ContaParaORaioX; error?: { message?: string } };
        if (!resposta.ok || !lido.data) {
          setErro(lido.error?.message ?? t("Não deu para ler a conta agora. Tente de novo."));
          return;
        }
        const c = lido.data;
        setConta(c);
        if (!escolhidos) {
          // A primeira leitura da empresa preenche o que vem da conta; a Time muda o que quiser depois.
          setNumeros(c.numeros.filter((n) => !n.arquivado).map((n) => n.id));
          setR((x) => ({
            ...x,
            empresa: c.empresa,
            segmento: c.segmento ?? x.segmento,
            abre: c.horario.abre,
            fecha: c.horario.fecha,
            sabado: c.horario.sabadoAte ? "sim" : "nao",
            sabado_ate: c.horario.sabadoAte ?? x.sabado_ate,
            responsavel_nome: c.responsavel?.nome ?? "",
            responsavel_contato: c.responsavel?.email ?? "",
          }));
        }
      } finally {
        setLendoConta(false);
      }
    },
    [t],
  );

  // O período e os números mudam a estimativa e as datas: relê sem sobrescrever o resto.
  useEffect(() => {
    if (fonte !== "conversas_da_mia" || !r.organization_id || !conta) return;
    const id = window.setTimeout(() => void lerConta(r.organization_id, r.periodo_dias, numeros), 300);
    return () => window.clearTimeout(id);
    // `conta` fica de fora de propósito: a releitura devolve outra `conta` e entraria em laço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonte, r.organization_id, r.periodo_dias, numeros, lerConta]);

  async function criar() {
    setErro(null);
    const daMia = fonte === "conversas_da_mia";
    if (daMia ? !r.organization_id || numeros.length === 0 : !r.empresa.trim() || !r.whatsapp.trim()) {
      setErro(daMia ? t("Escolha a empresa e pelo menos um número.") : t("Preencha pelo menos a empresa e o WhatsApp comercial."));
      return;
    }
    setSalvando(true);
    const teto = Math.round(Number(r.teto_reais.replace(",", ".")) * 100);
    const comum = {
      empresa: daMia ? (conta?.empresa ?? r.empresa) : r.empresa,
      segmento: r.segmento,
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
    };
    const corpo = daMia ? { ...comum, fonte: "conversas_da_mia", numeros } : { ...comum, whatsapp: r.whatsapp };
    const resposta = await gravar<Criado>("/api/v1/admin/raio-x", "POST", corpo, t);
    setSalvando(false);
    if (!resposta.ok) {
      setErro(resposta.mensagem);
      return;
    }
    setCriado({ ...resposta.data, fonte });
    toast.success(t("Raio-X criado. O link vale 48 horas."));
    router.refresh();
  }

  async function copiar(texto: string, aviso: string) {
    const ok = await copyToClipboard(texto);
    if (ok) toast.success(aviso);
    else toast.error(t("Não deu para copiar aqui. Selecione o texto e copie."));
  }

  const contar = (s: string) => lista.filter((x) => x.situacao === s).length;
  const empresaAtiva = ativas.find((e) => e.id === r.organization_id) ?? null;

  /** A situação como a lista do protótipo escreve. */
  const situacaoNaLista = (x: RaioXNaLista) => {
    if (x.ultimoRelatorio) return x.ultimoRelatorio.situacao === "rascunho" ? t("rascunho: revisar") : t("revisado");
    if (x.fonte === "conversas_da_mia" && x.situacao === "aguardando") return t("aguardando autorização");
    if (x.fonte === "conversas_da_mia" && x.situacao === "lendo") return t("lendo as conversas da conta");
    return t(ROTULO_DA_SITUACAO[x.situacao]);
  };

  const formularioDaConexao = (
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
      <Horario r={r} set={set} t={t} />
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
  );

  const formularioDaMia = (
    <div className="grid gap-4 md:grid-cols-2" data-raio-x="formulario-da-mia">
      <div className="space-y-1">
        <Label htmlFor="raio-x-conta">{t("Empresa da MIA")}</Label>
        <select
          id="raio-x-conta"
          className={SELECT}
          value={r.organization_id}
          onChange={(e) => {
            const id = e.target.value;
            set("organization_id", id);
            setConta(null);
            setNumeros([]);
            void lerConta(id, r.periodo_dias, null);
          }}
        >
          <option value="">{t("Escolha a empresa")}</option>
          {ativas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.demonstracao ? `${e.nome} · ${t("demonstração")}` : e.nome}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted">
          {t("Só aparecem empresas com assinatura ativa.")}
          {empresaAtiva ? ` ${t("Cliente desde {data}.").replace("{data}", dataLonga(empresaAtiva.clienteDesde))}` : ""}
        </p>
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
        <p className="text-xs text-text-muted">
          {conta?.segmento ? `${t("Da conta.")} ` : ""}
          {t("Define o que o relatório procura nas conversas.")}
        </p>
      </div>
      <fieldset className="space-y-2 md:col-span-2">
        <legend className="text-sm font-medium">{t("Quais números")}</legend>
        {lendoConta && !conta ? <p className="text-sm text-text-muted">{t("Lendo a conta…")}</p> : null}
        {conta && conta.numeros.length === 0 ? <p className="text-sm text-error-fg">{t("A conta não tem número de WhatsApp.")}</p> : null}
        {conta?.numeros.map((n) => (
          <label key={n.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm" data-raio-x-numero={n.id}>
            <input
              type="checkbox"
              checked={numeros.includes(n.id)}
              onChange={(e) => setNumeros((atual) => (e.target.checked ? [...atual, n.id] : atual.filter((x) => x !== n.id)))}
            />
            <b>{n.rotulo}</b>
            {n.telefone ? <span className="font-mono text-xs">{whatsappParaLer(n.telefone)}</span> : null}
            <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-xs">{n.oficial ? t("API oficial") : t("WhatsApp")}</span>
            {n.arquivado ? <span className="text-xs text-text-muted">{t("arquivado")}</span> : null}
            <span className="ml-auto text-xs text-text-muted">{t("{n} mensagens no período").replace("{n}", inteiro(n.mensagens))}</span>
          </label>
        ))}
        <p className="text-xs text-text-muted">{t("A API oficial também entra, porque a leitura é do que já está na conta, não do celular.")}</p>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="raio-x-periodo">{t("Período a ler")}</Label>
        <select id="raio-x-periodo" className={SELECT} value={r.periodo_dias} onChange={(e) => set("periodo_dias", e.target.value as Rascunho["periodo_dias"])}>
          <option value="30">{t("Últimos 30 dias")}</option>
          <option value="60">{t("Últimos 60 dias")}</option>
          <option value="90">{t("Últimos 90 dias")}</option>
        </select>
        {conta ? (
          <p className="text-xs text-text-muted" data-raio-x="periodo-da-conta">
            {t("{inicio} a {fim}.").replace("{inicio}", data(conta.periodo.inicio)).replace("{fim}", ultimoDia(conta.periodo.fim))}{" "}
            {conta.periodo.primeiraConversaEm ? t("A conta tem conversas desde {data}.").replace("{data}", data(conta.periodo.primeiraConversaEm)) : ""}
          </p>
        ) : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor="raio-x-tipo">{t("Tipo")}</Label>
        <select id="raio-x-tipo" className={SELECT} value={r.tipo} onChange={(e) => set("tipo", e.target.value as Rascunho["tipo"])}>
          <option value="unico">{t("Único")}</option>
          <option value="mensal">{t("Mensal · todo dia 1")}</option>
        </select>
        <p className="text-xs text-text-muted">
          {r.tipo === "unico" ? t("Um relatório agora. Para comparar depois, gere outro.") : t("Um relatório todo dia 1, sobre o mês anterior, sem conectar nada.")}
        </p>
      </div>
      <Horario r={r} set={set} t={t} daConta={conta?.horario.daConta ?? false} />
      <div className="space-y-1">
        <Label htmlFor="raio-x-teto">{t("Teto de custo da análise (R$)")}</Label>
        <Input id="raio-x-teto" inputMode="decimal" value={r.teto_reais} onChange={(e) => set("teto_reais", e.target.value)} />
        {conta ? (
          <p className="text-xs text-text-muted" data-raio-x="estimativa">
            {t("Estimativa para este período: {total} ({analise} da análise de {c} conversas + {audios} de {a} áudios).")
              .replace("{total}", reais(conta.estimativa.totalCentavos))
              .replace("{analise}", reais(conta.estimativa.analiseCentavos))
              .replace("{c}", inteiro(conta.estimativa.conversas))
              .replace("{audios}", reais(conta.estimativa.audiosCentavos))
              .replace("{a}", inteiro(conta.estimativa.audios))}
          </p>
        ) : (
          <p className="text-xs text-text-muted">{t("Ao bater o teto, a análise para e o relatório diz o que ficou de fora. Padrão R$ 40.")}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="raio-x-responsavel">{t("Quem autoriza")}</Label>
        <Input id="raio-x-responsavel" value={r.responsavel_nome} onChange={(e) => set("responsavel_nome", e.target.value)} placeholder={t("Nome do dono ou responsável")} />
        <p className="text-xs text-text-muted">{t("Vem do responsável da conta. Recebe o link de autorização e, depois, o link do relatório.")}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="raio-x-contato">{t("WhatsApp ou e-mail de quem autoriza")}</Label>
        <Input id="raio-x-contato" value={r.responsavel_contato} onChange={(e) => set("responsavel_contato", e.target.value)} placeholder={t("WhatsApp ou e-mail")} />
      </div>
      <p className="rounded-md bg-surface-elevated p-3 text-sm md:col-span-2">
        {t("Nada sai da conta e nenhuma mensagem é enviada. Os trechos do relatório seguem anonimizados, e o relatório só vai ao dono depois da revisão da Time.")}
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          [String(lista.length), t("raio-X criados")],
          [String(contar("aguardando") + contar("conectando")), t("aguardando o dono")],
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
          <h2 className="text-base font-semibold">{t("De onde vêm as conversas?")}</h2>
          <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label={t("De onde vêm as conversas?")}>
            {(
              [
                ["conexao", t("Conectar o WhatsApp"), t("Para quem ainda não é cliente. Segue como está hoje: o dono recebe o link, autoriza e conecta.")],
                ["conversas_da_mia", t("Conversas que já estão na MIA"), t("Para cliente ativo. Nada é conectado: o dono só autoriza pelo link, e entra até número da API oficial.")],
              ] as const
            ).map(([valor, titulo, texto]) => (
              <button
                key={valor}
                type="button"
                role="radio"
                aria-checked={fonte === valor}
                data-raio-x-fonte={valor}
                onClick={() => escolherFonte(valor)}
                className={`rounded-lg border p-4 text-left ${fonte === valor ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <b className="block text-sm">{titulo}</b>
                <span className="text-sm text-text-muted">{texto}</span>
              </button>
            ))}
          </div>
          <h2 className="text-base font-semibold">{t("Dados do raio-X")}</h2>
          {fonte === "conexao" ? formularioDaConexao : formularioDaMia}
          {erro ? <p className="text-sm text-error-fg">{erro}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" data-raio-x="criar" onClick={criar} disabled={salvando || (fonte === "conversas_da_mia" && (!conta || numeros.length === 0))}>
              {salvando ? t("Criando…") : fonte === "conexao" ? t("Criar e gerar o link") : t("Criar e gerar o link de autorização")}
            </Button>
            <span className="text-sm text-text-muted">
              {fonte === "conexao"
                ? t("O link vale 48 horas. Depois disso dá para gerar outro no detalhe.")
                : t("O link vale 48 horas. Depois que o dono autorizar, fica pronto em poucos minutos.")}
            </span>
          </div>
        </section>
      ) : null}

      {criado ? (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5" data-raio-x="link-pronto">
          <h2 className="text-base font-semibold">{t("Link pronto")}</h2>
          <p className="rounded-md bg-success-bg p-3 text-sm text-success-fg">{t("Raio-X criado. Agora é só mandar o link para o dono.")}</p>
          <div className="flex flex-wrap gap-2">
            <Input
              readOnly
              value={criado.link}
              className="flex-1"
              data-raio-x="link-de-conexao"
              aria-label={criado.fonte === "conversas_da_mia" ? t("Link de autorização") : t("Link de conexão")}
            />
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
              <th className="p-3 font-medium">{t("De onde vêm as conversas")}</th>
              <th className="p-3 font-medium">{t("Período")}</th>
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
            {lista.map((x) => {
              const daMia = x.fonte === "conversas_da_mia";
              const aguardandoODono = x.situacao === "aguardando" || x.situacao === "conectando";
              return (
                <tr key={x.id} className="border-t border-border align-top" data-raio-x-linha={x.empresa} data-raio-x-fonte-da-linha={x.fonte}>
                  <td className="p-3">
                    <b>{x.empresa}</b>
                    <div className="text-xs text-text-muted">
                      {daMia
                        ? t("cliente desde {data}").replace("{data}", dataLonga(x.clienteDesde))
                        : x.organizationId
                          ? x.clienteDesde && x.criadoEm < x.clienteDesde
                            ? t("antes de virar cliente")
                            : t("ligado à conta da MIA")
                          : t("ainda não é cliente")}
                    </div>
                    <div className="text-xs text-text-muted">{t(ROTULO_DO_SEGMENTO[x.segmento as keyof typeof ROTULO_DO_SEGMENTO] ?? ROTULO_DO_SEGMENTO.outro)}</div>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${daMia ? "bg-primary/10 text-primary" : "bg-surface-elevated"}`} data-raio-x-chip-da-fonte={x.fonte}>
                      {daMia ? t("Conversas da MIA") : t("Conexão do WhatsApp")}
                    </span>
                    <div className="text-xs text-text-muted">
                      {daMia ? (x.numeros === 1 ? t("1 número") : t("{n} números").replace("{n}", String(x.numeros))) : x.whatsappParaLer}
                    </div>
                  </td>
                  <td className="p-3">
                    {x.periodoInicio && x.periodoFim ? (
                      <>
                        {data(x.periodoInicio)} {t("a")} {daMia ? ultimoDia(x.periodoFim) : data(x.periodoFim)}
                      </>
                    ) : (
                      t("últimos {n} dias").replace("{n}", String(x.periodoDias))
                    )}
                    <div className="text-xs text-text-muted">
                      {x.tipo === "mensal" ? t("mensal · todo dia 1") : `${t(ROTULO_DO_TIPO[x.tipo])} · ${t("criado em")} ${data(x.criadoEm)}`}
                    </div>
                    {x.anterior ? (
                      <div className="text-xs text-text-muted">
                        {t("o anterior da mesma empresa é de")} {data(x.anterior.criadoEm)}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-xs" data-raio-x-situacao={x.situacao}>
                      {situacaoNaLista(x)}
                      {x.situacao === "lendo" && x.andamento !== null && !daMia ? ` · ${x.andamento}%` : ""}
                    </span>
                    {aguardandoODono && !x.linkVivo ? <div className="text-xs text-error-fg">{t("o link venceu")}</div> : null}
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
                      <Link href={`/admin/raio-x/${x.id}`}>
                        {aguardandoODono && x.linkVivo ? t("Ver o link") : x.ultimoRelatorio ? t("Abrir") : t("Acompanhar")}
                      </Link>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** O horário comercial e o sábado (as duas fontes). */
function Horario({
  r,
  set,
  t,
  daConta,
}: {
  r: Rascunho;
  set: <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => void;
  t: (s: string) => string;
  daConta?: boolean;
}) {
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="raio-x-abre">{t("Horário comercial")}</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input id="raio-x-abre" type="time" value={r.abre} onChange={(e) => set("abre", e.target.value)} aria-label={t("Abre às")} />
          <Input id="raio-x-fecha" type="time" value={r.fecha} onChange={(e) => set("fecha", e.target.value)} aria-label={t("Fecha às")} />
        </div>
        <p className="text-xs text-text-muted">
          {t("Separa o que chegou com a loja aberta e fechada.")}
          {daConta === undefined ? "" : ` ${daConta ? t("Do horário da conta; dá para mudar só neste raio-X.") : t("A conta não tem horário de funcionamento: confira.")}`}
        </p>
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
    </>
  );
}
