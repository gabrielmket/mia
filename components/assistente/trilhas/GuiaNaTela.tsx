"use client";

/**
 * FORK MIA (.93) — O "ME MOSTRA COMO": a guia que anda na tela de verdade.
 *
 * Protótipo aprovado em 26/10/2026, tela 1. Montada uma vez, ao lado do botão
 * do assistente no topo (`BotaoDoAssistente`), e desenhada num portal no
 * `<body>`: o recorte em volta do elemento do passo e o balão com o que fazer.
 *
 *   - ELE NUNCA CLICA PELA PESSOA. O destaque mostra onde; o clique é dela. A
 *     única coisa que a guia faz sozinha é levar até a tela do passo ("Me leva
 *     até lá"). `tests/unit/assistente-trilhas-marcadores.test.ts` reprova
 *     este arquivo se ele passar a disparar clique ou evento na tela.
 *   - CONFERE PELO SISTEMA, não pelo clique. O passo que abre uma tela ou uma
 *     janela confere a tela; o que grava confere no banco, pela rota das
 *     trilhas, com o login de quem usa. Se a pessoa fez por outro caminho, "Já
 *     fiz" confere o objetivo e conta.
 *   - PAUSAR E RETOMAR. O passo fica no banco, por pessoa; ao retomar, a guia
 *     volta ao passo que abre o que se perdeu e diz de onde segue.
 *   - NÃO GASTA IA. Os passos e as conferências são fixos (`catalogo.ts`).
 *
 * O destaque se prende aos marcadores `data-testid` que o sistema-base já usa
 * nos testes; onde faltava, entrou um nosso, marcado FORK MIA.
 *
 * ── Por cima de uma janela aberta ───────────────────────────────────────────
 *
 * Vários passos acontecem dentro de uma janela (o QR Code, o motivo da perda).
 * A janela do sistema prende o foco e fecha com clique fora dela. O balão da
 * guia fica por cima (camada acima da janela), aceita o ponteiro mesmo com o
 * resto da página travado, não rouba o foco ao clicar e não deixa o clique
 * nele chegar à janela como "clique fora". Assim "Pausar" ou "Pronto, confere"
 * não fecham a janela da pessoa.
 */
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth/AuthProvider";
import {
  CHAVE_DAS_TRILHAS,
  comecarATrilha,
  definirGuia,
  mudarGuia,
  postarNaTrilha,
  useGuiaDaTrilha,
  useTrilhas,
  type ConferidoNaTela,
  type GuiaAtiva,
} from "@/hooks/assistente/useTrilhas";
import { useT } from "@/hooks/i18n/useT";
import {
  encaixar,
  irDoPasso,
  leiturasDaConferencia,
  papelFaz,
  rotaCasa,
  trilhaPorId,
  type Conferencia,
  type PassoDaTrilha,
  type Trilha,
} from "@/lib/assistente/trilhas/catalogo";
import { destinoDaTela } from "@/lib/assistente/telas";
import { ROTULO_DA_FONTE } from "@/lib/assistente/tipos";
import { cn } from "@/lib/utils";

/** De quanto em quanto tempo a guia olha a tela (o destaque e as conferências da tela). */
const OLHAR_A_TELA_MS = 400;
/** De quanto em quanto tempo a guia confere no sistema, num passo que grava. */
const CONFERIR_NO_SISTEMA_MS = 4000;

interface GuiaMontada {
  titulo: string;
  passos: PassoDaTrilha[];
  trilha: Trilha | null;
  fontes: readonly string[];
}

function montar(g: GuiaAtiva, t: (s: string) => string): GuiaMontada | null {
  if (g.trilha) {
    const trilha = trilhaPorId(g.trilha);
    if (!trilha) return null;
    return { titulo: trilha.titulo, passos: [...trilha.passos], trilha, fontes: trilha.fontes };
  }
  if (!g.manual) return null;
  // O guia curto de um manual: abrir a tela (conferida) e os passos do manual.
  const destino = destinoDaTela(g.manual.href);
  const abrir: PassoDaTrilha = {
    texto: destino ? `${t("Abra a tela")} ${t(destino.label)}.` : t("Abra a tela deste manual."),
    tela: g.manual.href,
    ir: g.manual.href,
    confere: t("a tela aberta"),
    conferencia: { ve: "tela", rota: g.manual.href },
  };
  return {
    titulo: g.manual.titulo,
    passos: [
      abrir,
      ...g.manual.passos.map((texto) => ({ texto, confere: t("nada aqui: é o passo do manual"), conferencia: { ve: "seguir" } as Conferencia })),
    ],
    trilha: null,
    fontes: ["Manual do sistema"],
  };
}

/** `etapas-{funil}` com o id que uma leitura anterior trouxe; `*` no fim cerca o primeiro que começa assim. */
function seletorDoAlvo(alvo: string, ids: Record<string, string>): string | null {
  let faltou = false;
  const resolvido = alvo.replace(/\{([a-z_]+)\}/g, (_, chave: string) => {
    const v = ids[chave];
    if (!v) faltou = true;
    return v ?? "";
  });
  if (faltou) return null;
  const aspas = (s: string) => s.replace(/["\\]/g, "\\$&");
  return resolvido.endsWith("*") ? `[data-testid^="${aspas(resolvido.slice(0, -1))}"]` : `[data-testid="${aspas(resolvido)}"]`;
}

function visivel(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function acharNaTela(seletor: string | null): HTMLElement | null {
  if (!seletor) return null;
  for (const el of document.querySelectorAll<HTMLElement>(seletor)) {
    if (el.closest("[data-guia-da-trilha]")) continue;
    if (visivel(el)) return el;
  }
  return null;
}

const ESCOLHIDO =
  '[aria-pressed="true"],[aria-checked="true"],[aria-selected="true"],[data-state="active"],[data-state="checked"],[data-state="on"],input:checked';

function valorDoCampo(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value;
  const campo = el.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
  return campo?.value ?? "";
}

type Leitura = "ok" | "nao" | "sistema";

/** A conferência que a TELA responde. `sistema` = depende do banco (a rota confere). */
function conferirNaTela(c: Conferencia, caminho: string, ids: Record<string, string>): Leitura {
  switch (c.ve) {
    case "tela":
      return rotaCasa(caminho, c.rota) ? "ok" : "nao";
    case "elemento":
      return acharNaTela(seletorDoAlvo(c.alvo, ids)) ? "ok" : "nao";
    case "na_tela": {
      const el = acharNaTela(seletorDoAlvo(c.alvo, ids));
      if (!el) return "nao";
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight - 40 && r.bottom > 40 ? "ok" : "nao";
    }
    case "preenchido": {
      const el = acharNaTela(seletorDoAlvo(c.alvo, ids));
      if (!el) return "nao";
      const valor = valorDoCampo(el).trim();
      if (c.email) return valor.split(/[\s,;]+/).some((v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) ? "ok" : "nao";
      return valor.length >= (c.minimo ?? 1) ? "ok" : "nao";
    }
    case "marcado": {
      const el = acharNaTela(seletorDoAlvo(c.alvo, ids));
      return el && (el.matches(ESCOLHIDO) || el.querySelector(ESCOLHIDO)) ? "ok" : "nao";
    }
    case "sistema":
      return "sistema";
    case "algum": {
      const partes = c.de.map((x) => conferirNaTela(x, caminho, ids));
      if (partes.includes("ok")) return "ok";
      return partes.includes("sistema") ? "sistema" : "nao";
    }
    case "seguir":
      return "nao";
  }
}

/** O balão perto do elemento, quando cabe; senão, encostado no canto. */
function lugarDoBalao(
  alvo: DOMRect | null,
  balao: { w: number; h: number },
): { estilo: CSSProperties; encostado: boolean } {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const encostado = { estilo: { right: 16, bottom: 16 } as CSSProperties, encostado: true };
  if (!alvo || W < 720 || balao.w === 0) return encostado;
  const entre = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
  if (alvo.right + 16 + balao.w < W - 8) return { estilo: { left: alvo.right + 16, top: entre(alvo.top - 8, 72, H - balao.h - 16) }, encostado: false };
  if (alvo.bottom + 12 + balao.h < H - 8) return { estilo: { left: entre(alvo.left, 16, W - balao.w - 16), top: alvo.bottom + 12 }, encostado: false };
  if (alvo.top - 12 - balao.h > 64) return { estilo: { left: entre(alvo.left, 16, W - balao.w - 16), top: alvo.top - 12 - balao.h }, encostado: false };
  if (alvo.left - 16 - balao.w > 8) return { estilo: { left: alvo.left - 16 - balao.w, top: entre(alvo.top - 8, 72, H - balao.h - 16) }, encostado: false };
  return encostado;
}

export function GuiaNaTela() {
  // No servidor e na hidratação a guia é `null` (a guarda da aba só existe no navegador):
  // o portal só nasce no cliente.
  const guia = useGuiaDaTrilha();
  if (!guia || typeof document === "undefined") return null;
  return createPortal(<GuiaAndando key={guia.vez} guia={guia} />, document.body);
}

function GuiaAndando({ guia }: { guia: GuiaAtiva }) {
  const t = useT();
  const router = useRouter();
  const caminho = usePathname() ?? "/app";
  const qc = useQueryClient();
  const { activeOrg } = useAuth();
  const trilhas = useTrilhas();
  const montada = useMemo(() => montar(guia, t), [guia, t]);
  const [alvo, setAlvo] = useState<DOMRect | null>(null);
  const [tamanho, setTamanho] = useState({ w: 0, h: 0 });
  const [conferindo, setConferindo] = useState(false);
  // Ao retomar: o recado de onde seguiu (a guia remonta a cada começo, pela chave `vez`).
  const [recado, setRecado] = useState<string | null>(() =>
    guia.retomada && montada
      ? `${t("Voltamos de onde você parou. O que estava aberto e não foi salvo se perdeu; seguimos de")} "${t(montada.passos[guia.passo]?.texto ?? "")}"`
      : null,
  );
  const [semAlvoHa, setSemAlvoHa] = useState(0);
  const [verPassos, setVerPassos] = useState(false);
  const balao = useRef<HTMLDivElement | null>(null);
  const rolado = useRef<number>(-1);
  const emVoo = useRef(false);
  const ultimaConferencia = useRef(0);
  // O passo que já avançou: a próxima olhada da tela pode chegar antes do novo desenho.
  const avancado = useRef<number>(-1);

  const passos = montada?.passos ?? [];
  const terminou = guia.fim !== null || guia.passo >= passos.length;
  const passo = terminou ? null : (passos[guia.passo] ?? null);
  const foraDaTela = Boolean(passo?.tela && !rotaCasa(caminho, passo.tela));
  const leituras = passo ? leiturasDaConferencia(passo.conferencia) : [];

  const invalidar = useCallback(() => void qc.invalidateQueries({ queryKey: CHAVE_DAS_TRILHAS }), [qc]);

  // Ao retomar: leva até a tela do passo (a única coisa que a guia faz sozinha).
  useEffect(() => {
    if (!guia.ir) return;
    const destino = guia.ir;
    mudarGuia((g) => ({ ...g, ir: null }));
    if (!rotaCasa(caminho, destino)) router.push(destino);
    // Só na montagem da guia retomada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guia.vez]);

  const terminar = useCallback(
    (fim: string) => {
      mudarGuia((g) => ({ ...g, passo: passos.length, fim }));
      invalidar();
      toast.success(`${t("Trilha feita")}: ${t(montada?.titulo ?? "")}`);
    },
    [invalidar, montada?.titulo, passos.length, t],
  );

  const avancar = useCallback(
    (conferido: string | null, extra?: { vars?: Record<string, string>; ids?: Record<string, string> }) => {
      const atual = guia.passo;
      if (avancado.current === atual) return;
      avancado.current = atual;
      const proximo = atual + 1;
      setRecado(null);
      setSemAlvoHa(0);
      mudarGuia((g) => ({
        ...g,
        passo: proximo,
        feitos: { ...g.feitos, [atual]: conferido ?? t("Feito.") },
        vars: { ...g.vars, ...(extra?.vars ?? {}) },
        ids: { ...g.ids, ...(extra?.ids ?? {}) },
        retomada: false,
      }));
      if (guia.trilha) {
        if (proximo < passos.length) {
          void postarNaTrilha({ acao: "avancar", trilha: guia.trilha, passo: proximo }).catch(() => undefined);
        } else {
          // Acabaram os passos sem a leitura final: quem decide é o objetivo, no sistema.
          void postarNaTrilha<ConferidoNaTela>({ acao: "ja_fiz", trilha: guia.trilha, passo: atual })
            .then((r) => (r.feita && r.fim ? terminar(t(r.fim)) : setRecado(t("Ainda não vejo o objetivo no sistema."))))
            .catch(() => undefined);
        }
      } else if (proximo >= passos.length) {
        terminar(t("Pronto. Esses são os passos do manual. Se algo não bater com a sua tela, me pergunte ou mande ao suporte."));
      }
    },
    [guia.passo, guia.trilha, passos.length, t, terminar],
  );

  const textoConferido = useCallback(
    (p: PassoDaTrilha, vars: Record<string, string>) => (p.conferido ? encaixar(t(p.conferido), vars) : null),
    [t],
  );

  // ── conferir no sistema (o passo que grava) ──
  const conferirNoSistema = useCallback(
    async (manual = false) => {
      if (!guia.trilha || !passo || leituras.length === 0 || emVoo.current) return;
      emVoo.current = true;
      ultimaConferencia.current = Date.now();
      if (manual) setConferindo(true);
      try {
        const r = await postarNaTrilha<ConferidoNaTela>({ acao: "conferir", trilha: guia.trilha, passo: guia.passo });
        if (r.feita && r.fim) {
          mudarGuia((g) => ({ ...g, feitos: { ...g.feitos, [g.passo]: textoConferido(passo, { ...g.vars, ...r.vars }) ?? t("Feito.") } }));
          terminar(encaixar(t(trilhaPorId(guia.trilha)?.fim ?? r.fim), { ...guia.vars, ...r.vars }));
        } else if (r.ok) {
          avancar(textoConferido(passo, { ...guia.vars, ...r.vars }), { vars: r.vars, ids: r.ids });
        } else if (manual) {
          setRecado(`${t("Ainda não vejo")} ${t(passo.confere)}.`);
        }
      } catch {
        if (manual) setRecado(t("Não deu para conferir agora. Tente de novo em instantes."));
      } finally {
        emVoo.current = false;
        setConferindo(false);
      }
    },
    [avancar, guia.passo, guia.trilha, guia.vars, leituras.length, passo, t, terminar, textoConferido],
  );

  // ── olhar a tela: o destaque, as conferências da tela e o "sistema" de tempos em tempos ──
  useEffect(() => {
    if (!passo) return;
    const olhar = () => {
      const seletor = passo.alvo ? seletorDoAlvo(passo.alvo, guia.ids) : null;
      let el = acharNaTela(seletor);
      // "Abra X, no menu": sem marcador próprio, cerca o link do menu, quando ele está à vista.
      const ir = irDoPasso(passo);
      if (!el && !passo.alvo && ir && foraDaTela) el = acharNaTela(`a[href="${ir}"]`);
      const novo = el && (!foraDaTela || !passo.alvo) ? el.getBoundingClientRect() : null;
      setAlvo((antes) =>
        antes && novo && antes.left === novo.left && antes.top === novo.top && antes.width === novo.width && antes.height === novo.height
          ? antes
          : novo,
      );
      if (el && rolado.current !== guia.passo && !foraDaTela) {
        rolado.current = guia.passo;
        const r = el.getBoundingClientRect();
        if (r.top < 64 || r.bottom > window.innerHeight - 16) el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      if (balao.current) setTamanho((a) => (a.w === balao.current!.offsetWidth && a.h === balao.current!.offsetHeight ? a : { w: balao.current!.offsetWidth, h: balao.current!.offsetHeight }));
      setSemAlvoHa((n) => (passo.alvo && !el && !foraDaTela ? n + OLHAR_A_TELA_MS : 0));

      const naTela = conferirNaTela(passo.conferencia, caminho, guia.ids);
      if (naTela === "ok") {
        avancar(textoConferido(passo, guia.vars));
        return;
      }
      if (
        naTela === "sistema" &&
        guia.trilha &&
        document.visibilityState === "visible" &&
        Date.now() - ultimaConferencia.current >= CONFERIR_NO_SISTEMA_MS
      ) {
        void conferirNoSistema(false);
      }
    };
    olhar();
    const iv = window.setInterval(olhar, OLHAR_A_TELA_MS);
    return () => window.clearInterval(iv);
  }, [avancar, caminho, conferirNoSistema, foraDaTela, guia.ids, guia.passo, guia.trilha, guia.vars, passo, textoConferido]);

  // ── o balão não fecha a janela do sistema nem rouba o foco dela ──
  useEffect(() => {
    const el = balao.current;
    if (!el) return;
    // Para aqui (a janela do sistema não vê um "clique fora") e, no mousedown, não
    // tira o foco de quem está preenchendo a janela; o clique no botão continua.
    const parar = (e: Event) => {
      e.stopPropagation();
      if (e.type === "mousedown") e.preventDefault();
    };
    el.addEventListener("pointerdown", parar);
    el.addEventListener("mousedown", parar);
    el.addEventListener("touchstart", parar);
    return () => {
      el.removeEventListener("pointerdown", parar);
      el.removeEventListener("mousedown", parar);
      el.removeEventListener("touchstart", parar);
    };
  }, [terminou]);

  if (!montada) return null;

  async function pausar() {
    if (guia.trilha && !terminou) {
      try {
        await postarNaTrilha({ acao: "pausar", trilha: guia.trilha, passo: guia.passo });
        toast.info(`${t("Pausei")} "${t(montada!.titulo)}" ${t("no passo")} ${guia.passo + 1} ${t("de")} ${passos.length}. ${t("Ela fica em Assistente › Trilhas.")}`);
      } catch {
        toast.error(t("Não deu para guardar o passo agora."));
      }
      invalidar();
    }
    definirGuia(null);
  }

  async function jaFiz() {
    if (!guia.trilha || !montada?.trilha) return;
    setConferindo(true);
    try {
      const r = await postarNaTrilha<ConferidoNaTela>({ acao: "ja_fiz", trilha: guia.trilha, passo: guia.passo });
      if (r.feita) terminar(encaixar(t(montada.trilha.fim), { ...guia.vars, ...r.vars }));
      else setRecado(`${t("Ainda não vejo isso no sistema. A trilha fica feita quando")} ${t(montada.trilha.pronto)}`);
    } catch {
      setRecado(t("Não deu para conferir agora. Tente de novo em instantes."));
    } finally {
      setConferindo(false);
    }
  }

  function meLeva() {
    if (!passo) return;
    const proprio = irDoPasso(passo);
    if (proprio) {
      router.push(proprio);
      return;
    }
    // O passo é numa tela com id (o agente aberto): volta ao passo que abre essa tela.
    for (let i = passo.retomaEm ?? guia.passo - 1; i >= 0; i -= 1) {
      const ir = irDoPasso(passos[i]!);
      if (ir) {
        avancado.current = -1;
        mudarGuia((g) => ({ ...g, passo: i, feitos: Object.fromEntries(Object.entries(g.feitos).filter(([k]) => Number(k) < i)) }));
        setRecado(`${t("Te trouxe de volta. Seguimos de")} "${t(passos[i]!.texto)}"`);
        if (!rotaCasa(caminho, ir)) router.push(ir);
        return;
      }
    }
  }

  const lugar = lugarDoBalao(alvo, tamanho);
  const papel = activeOrg?.role ?? null;
  const proxima = montada.trilha?.proxima ? trilhaPorId(montada.trilha.proxima) : null;
  const proximaFeita = proxima ? trilhas.data?.trilhas.find((x) => x.id === proxima.id)?.estado === "feita" : true;
  const nomeDaTela = (p: PassoDaTrilha) => {
    const d = destinoDaTela(irDoPasso(p) ?? p.tela ?? null);
    return d ? t(d.label) : t("outra tela");
  };
  const temSistema = leituras.length > 0;
  const preenche = passo?.conferencia.ve === "preenchido";

  return (
    <div data-guia-da-trilha="" aria-live="polite">
      {alvo && !terminou ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[70] rounded-lg border-[3px] border-primary shadow-[0_0_0_4px_rgba(59,130,246,0.25)] motion-safe:animate-pulse"
          style={{ left: alvo.left - 6, top: alvo.top - 6, width: alvo.width + 12, height: alvo.height + 12 }}
          data-testid="destaque-da-trilha"
        />
      ) : null}
      <div
        ref={balao}
        role="dialog"
        aria-label={t("Me mostra como")}
        data-testid="balao-da-trilha"
        className={cn(
          "fixed z-[71] flex max-h-[70vh] w-[min(360px,calc(100vw-32px))] flex-col gap-2 overflow-y-auto rounded-xl border bg-background p-3 text-sm shadow-xl",
          lugar.encostado ? "" : "",
        )}
        style={{ ...lugar.estilo, pointerEvents: "auto" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-primary">{t("Me mostra como")}</p>
            <p className="font-semibold">{t(montada.titulo)}</p>
          </div>
          {!terminou ? (
            <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-text-muted">
              {t("Passo")} {guia.passo + 1} {t("de")} {passos.length}
            </span>
          ) : null}
        </div>

        {terminou ? (
          <>
            <p className="rounded-md bg-success-bg p-2 text-success-fg" data-testid="fim-da-trilha">
              ✓ {guia.fim}
            </p>
            {montada.fontes.length > 0 ? (
              <p className="text-xs text-text-muted">
                {t("De onde veio")}: {montada.fontes.map((f) => (ROTULO_DA_FONTE[f] ? t(ROTULO_DA_FONTE[f]) : f)).join(", ")}
              </p>
            ) : null}
            {proxima && !proximaFeita && papelFaz(proxima, papel) ? (
              <p className="text-xs">
                {t("Próxima trilha que eu sugiro")}: <strong>{t(proxima.titulo)}</strong>.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {proxima && !proximaFeita && papelFaz(proxima, papel) ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-11 lg:h-8"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void comecarATrilha(proxima.id).catch(() => toast.error(t("Não deu para começar a trilha agora.")))}
                >
                  {t("Me mostra como")}
                </Button>
              ) : null}
              <Button asChild size="sm" variant="outline" className="h-11 lg:h-8">
                <Link href="/app/assistente?aba=trilhas" onClick={() => definirGuia(null)}>
                  {t("Ver as trilhas")}
                </Link>
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-11 lg:h-8" onMouseDown={(e) => e.preventDefault()} onClick={() => definirGuia(null)}>
                {t("Fechar")}
              </Button>
            </div>
          </>
        ) : passo ? (
          <>
            {guia.feitos[guia.passo - 1] ? <p className="text-xs text-success-fg">✓ {guia.feitos[guia.passo - 1]}</p> : null}
            <p className="text-base leading-snug">{t(passo.texto)}</p>
            {passo.fora ? <p className="rounded-md bg-surface-muted p-2 text-xs">{t(passo.fora)}</p> : null}
            {passo.soVoce ? <p className="text-xs text-text-muted">{t("Esse clique é só seu: eu não faço.")}</p> : null}
            {foraDaTela && guia.passo > 0 ? (
              <p className="rounded-md bg-warning-bg p-2 text-xs text-warning-fg">
                {t("O passo agora é em")} {nomeDaTela(passo)}, {t("e você saiu de lá.")}
              </p>
            ) : null}
            {!foraDaTela && passo.alvo && semAlvoHa > 4000 ? (
              <p className="text-xs text-text-muted">
                {t("Ainda não vejo o lugar deste passo na tela. Ele aparece quando a tela termina de carregar ou depois do passo anterior.")}
              </p>
            ) : null}
            <p className="text-xs text-text-muted">
              {t("Eu confiro")}: {t(passo.confere)}
              {temSistema && guia.trilha ? ` · ${t("no sistema, com o seu login")}` : ""}
              {conferindo ? ` · ${t("conferindo…")}` : ""}
            </p>
            {recado ? <p className="rounded-md bg-surface-muted p-2 text-xs">{recado}</p> : null}
            <div className="flex flex-wrap gap-2">
              {foraDaTela && (irDoPasso(passo) || guia.passo > 0) ? (
                <Button type="button" size="sm" className="h-11 lg:h-8" onMouseDown={(e) => e.preventDefault()} onClick={meLeva}>
                  {t("Me leva até lá")}
                </Button>
              ) : null}
              {passo.conferencia.ve === "seguir" ? (
                <Button type="button" size="sm" className="h-11 lg:h-8" onMouseDown={(e) => e.preventDefault()} onClick={() => avancar(null)}>
                  {t("Feito, próximo")}
                </Button>
              ) : null}
              {temSistema && guia.trilha && !foraDaTela ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 lg:h-8"
                  disabled={conferindo}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void conferirNoSistema(true)}
                >
                  {t("Pronto, confere")}
                </Button>
              ) : null}
              {preenche && !foraDaTela ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 lg:h-8"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setRecado(`${t("Ainda não vejo")} ${t(passo.confere)}.`)}
                >
                  {t("Pronto, confere")}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs">
              {guia.trilha ? (
                <button
                  type="button"
                  className="min-h-11 underline lg:min-h-0"
                  disabled={conferindo}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void jaFiz()}
                >
                  {t("Já fiz por outro caminho")}
                </button>
              ) : null}
              <button type="button" className="min-h-11 underline lg:min-h-0" onMouseDown={(e) => e.preventDefault()} onClick={() => setVerPassos((v) => !v)}>
                {verPassos ? t("Esconder os passos") : t("Ver os passos")}
              </button>
              <button
                type="button"
                className="ml-auto min-h-11 font-medium lg:min-h-0"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pausar()}
                data-testid="pausar-a-trilha"
              >
                {guia.trilha ? t("Pausar") : t("Fechar")}
              </button>
            </div>
            {verPassos ? (
              <ol className="list-decimal space-y-1 pl-5 text-xs">
                {passos.map((p, i) => (
                  <li key={i} className={i < guia.passo ? "text-success-fg" : i === guia.passo ? "font-medium" : "text-text-muted"}>
                    {i < guia.passo ? "✓ " : ""}
                    {t(p.texto)}
                  </li>
                ))}
              </ol>
            ) : null}
            <p className="text-[11px] text-text-muted">{t("Eu destaco e confiro. Quem clica é sempre você.")}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
