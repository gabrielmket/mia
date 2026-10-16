"use client";

/**
 * FORK MIA (item 9) — o painel do usuário (protótipo, tela 5).
 *
 * Cada relatório é calculado no banco com o período do painel (ou o próprio,
 * quando marcado), ao abrir e a cada 5 minutos. Reordenar grava UM item (a
 * posição é fracionária: entre a do vizinho de cima e a do de baixo), pelas
 * setas ou arrastando no computador.
 */
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { alterarItem, alterarPainel, calcular, mensagemDoErro, tirarItem, type Calculado } from "@/components/relatorios/api";
import { CLASSE_DO_TAMANHO } from "@/components/relatorios/GradeDoPainel";
import { GraficoDoRelatorio, type AlvoDoClique } from "@/components/relatorios/Grafico";
import { ListaPorTras, type ListaAberta } from "@/components/relatorios/ListaPorTras";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { modeloDoGrafico } from "@/lib/relatorios/apresentar";
import {
  ATUALIZAR_A_CADA_MS,
  PERIODOS_DO_PAINEL,
  ROTULO_DO_PERIODO_DO_MONTADOR,
  ROTULO_DO_TAMANHO,
  TAMANHOS,
  type PeriodoDoPainel,
  type Tamanho,
} from "@/lib/relatorios/catalogo";
import { visualizacaoQueVale, type ConfigDoRelatorio } from "@/lib/relatorios/config";
import { fraseDoPeriodo } from "@/lib/relatorios/frases";

interface Item {
  id: string;
  tamanho: Tamanho;
  periodoProprio: boolean;
  posicao: number;
  relatorioId: string | null;
  pronto: string | null;
  titulo: string | null;
  config: ConfigDoRelatorio | null;
  pessoa: boolean;
}

interface Props {
  painel: { id: string; nome: string; periodo: PeriodoDoPainel; compartilhado: boolean; meu: boolean };
  itens: Item[];
  periodoInicial: PeriodoDoPainel;
  permissoes: { editar: boolean; compartilhar: boolean; exportar: boolean; valores: boolean };
  link: { url: string; validoAte: string } | null;
}

/** A posição de quem vai para o lugar `destino` (indexação fracionária). */
function posicaoNoLugar(lista: Item[], id: string, destino: number): number {
  const resto = lista.filter((i) => i.id !== id);
  if (resto.length === 0) return 1;
  if (destino <= 0) return resto[0]!.posicao - 1;
  if (destino >= resto.length) return resto[resto.length - 1]!.posicao + 1;
  return (resto[destino - 1]!.posicao + resto[destino]!.posicao) / 2;
}

export function PainelDoUsuario({ painel, itens: iniciais, periodoInicial, permissoes, link: linkInicial }: Props) {
  const t = useT();
  const router = useRouter();
  const [itens, setItens] = useState(() => [...iniciais].sort((a, b) => a.posicao - b.posicao));
  const [periodo, setPeriodo] = useState<PeriodoDoPainel>(periodoInicial);
  const [compartilhado, setCompartilhado] = useState(painel.compartilhado);
  const [lista, setLista] = useState<{ aberta: ListaAberta; config: ConfigDoRelatorio; periodo: PeriodoDoPainel | null } | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [link, setLink] = useState(linkInicial);
  const [gerar, setGerar] = useState(false);

  async function mudarItem(id: string, mudanca: Partial<Pick<Item, "tamanho" | "periodoProprio" | "posicao">>) {
    const antes = itens;
    setItens((xs) => [...xs.map((x) => (x.id === id ? { ...x, ...mudanca } : x))].sort((a, b) => a.posicao - b.posicao));
    try {
      await alterarItem(painel.id, id, { tamanho: mudanca.tamanho, periodo_proprio: mudanca.periodoProprio, posicao: mudanca.posicao });
    } catch (e) {
      setItens(antes);
      toast.error(mensagemDoErro(e, t));
    }
  }

  function mover(id: string, destino: number) {
    void mudarItem(id, { posicao: posicaoNoLugar(itens, id, destino) });
  }

  async function tirar(id: string) {
    const antes = itens;
    setItens((xs) => xs.filter((x) => x.id !== id));
    try {
      await tirarItem(painel.id, id);
    } catch (e) {
      setItens(antes);
      toast.error(mensagemDoErro(e, t));
    }
  }

  async function trocarPeriodo(p: PeriodoDoPainel) {
    setPeriodo(p);
    router.replace(`/app/relatorios/paineis/${painel.id}?periodo=${p}`, { scroll: false });
    if (permissoes.editar) {
      try {
        await alterarPainel(painel.id, { periodo: p });
      } catch {
        /* o período continua valendo para quem olha */
      }
    }
  }

  async function compartilhar() {
    try {
      await alterarPainel(painel.id, { compartilhado: !compartilhado });
      setCompartilhado(!compartilhado);
      toast.success(!compartilhado ? t("Painel compartilhado com a equipe.") : t("O painel voltou a ser só seu."));
    } catch (e) {
      toast.error(mensagemDoErro(e, t));
    }
  }

  const deFora = itens.filter((i) => i.pessoa).length;

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <nav aria-label={t("Caminho")} className="text-sm text-text-muted">
        <Link href="/app/relatorios/paineis" className="inline-flex min-h-11 items-center hover:underline lg:min-h-0">
          {t("Meus painéis")}
        </Link>{" "}
        / {painel.nome}
      </nav>
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{painel.nome}</h1>
          <p className="text-sm text-text-muted">
            {t("Relatórios salvos lado a lado, em três tamanhos. O período do painel vale para todos, menos para quem marcou período próprio.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissoes.compartilhar && permissoes.editar ? (
            <Button variant="outline" onClick={() => void compartilhar()}>
              {compartilhado ? t("Parar de compartilhar") : t("Compartilhar com a equipe")}
            </Button>
          ) : null}
          {permissoes.compartilhar ? <Button onClick={() => setGerar(true)}>{t("Gerar link para o dono")}</Button> : null}
          <Link
            href="/app/relatorios"
            className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
          >
            {t("Adicionar relatório")}
          </Link>
        </div>
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <div role="group" aria-label={t("Período do painel")} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-text-muted">{t("Período do painel")}</span>
          {PERIODOS_DO_PAINEL.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={periodo === p}
              onClick={() => void trocarPeriodo(p)}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 text-base lg:min-h-8 lg:text-sm ${periodo === p ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface-elevated"}`}
            >
              {t(ROTULO_DO_PERIODO_DO_MONTADOR[p])}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 ${compartilhado ? "bg-accent-soft text-accent" : "bg-surface-elevated text-text-muted"}`}>
            {compartilhado ? t("Compartilhado com a equipe") : painel.meu ? t("Só você vê") : t("Só da pessoa")}
          </span>
          {permissoes.compartilhar ? (
            <span className={`rounded-full px-2 py-0.5 ${link ? "bg-success-bg text-success-fg" : "bg-surface-elevated text-text-muted"}`}>
              {link ? `${t("Link para o dono ativo até")} ${link.validoAte}` : t("Sem link para o dono")}
            </span>
          ) : (
            <span className="text-text-muted">{t("Compartilhar e gerar link é para gestor e administrador.")}</span>
          )}
        </div>
      </div>

      {!permissoes.editar ? (
        <p className="text-sm text-text-muted">{t("Você vê o painel da equipe com os seus números: a mesma tela, só com o que você já vê no CRM.")}</p>
      ) : null}

      {itens.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-text-muted">
          {t("Painel vazio. Abra um relatório e use \"Adicionar a um painel\".")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {itens.map((item, i) => (
            <CartaoDoItem
              key={item.id}
              item={item}
              indice={i}
              total={itens.length}
              periodo={periodo}
              editar={permissoes.editar}
              arrastando={arrastando}
              onArrastar={setArrastando}
              onSoltar={(origem) => {
                mover(origem, i);
                setArrastando(null);
              }}
              onMudar={(m) => void mudarItem(item.id, m)}
              onMover={(d) => mover(item.id, i + d)}
              onTirar={() => void tirar(item.id)}
              onClicar={(aberta) => item.config && setLista({ aberta, config: item.config, periodo: item.periodoProprio ? null : periodo })}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-text-muted">
        {t("Tamanhos: P ocupa um quarto da linha, M metade, G a linha inteira. No celular, todos ocupam a largura toda. A ordem e os tamanhos valem para quem vê o painel compartilhado.")}
      </p>

      {lista ? (
        <ListaPorTras
          aberta={lista.aberta}
          onFechar={() => setLista(null)}
          config={lista.config}
          periodo={lista.periodo}
          podeExportar={false}
        />
      ) : null}

      <GerarLink
        aberto={gerar}
        onFechar={() => setGerar(false)}
        painelId={painel.id}
        deFora={deFora}
        link={link}
        onCriado={(l) => setLink(l)}
        valores={permissoes.valores}
      />
    </div>
  );
}

function CartaoDoItem({
  item,
  indice,
  total,
  periodo,
  editar,
  arrastando,
  onArrastar,
  onSoltar,
  onMudar,
  onMover,
  onTirar,
  onClicar,
}: {
  item: Item;
  indice: number;
  total: number;
  periodo: PeriodoDoPainel;
  editar: boolean;
  arrastando: string | null;
  onArrastar: (id: string | null) => void;
  onSoltar: (origem: string) => void;
  onMudar: (m: Partial<Pick<Item, "tamanho" | "periodoProprio">>) => void;
  onMover: (d: number) => void;
  onTirar: () => void;
  onClicar: (a: ListaAberta) => void;
}) {
  const t = useT();
  const [calc, setCalc] = useState<Calculado | null>(null);
  const [erro, setErro] = useState(false);
  const periodoDoItem = item.periodoProprio ? null : periodo;

  const pedir = useCallback(async () => {
    if (!item.config) return;
    try {
      setCalc(await calcular(item.config, periodoDoItem));
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [item.config, periodoDoItem]);

  useEffect(() => {
    void pedir();
    const relogio = setInterval(() => void pedir(), ATUALIZAR_A_CADA_MS);
    return () => clearInterval(relogio);
  }, [pedir]);

  const modelo = calc ? modeloDoGrafico(calc.resposta, calc.config.medida, calc.nomes) : null;
  const vis = calc ? visualizacaoQueVale(calc.config, calc.resposta) : "barras";
  const periodoTexto = calc ? fraseDoPeriodo(periodoDoItem ?? calc.config.periodo, calc.resposta.janela, t) : "";

  function clicar(a: AlvoDoClique) {
    onClicar({
      chave1: a.chave1,
      chave2: a.chave2,
      funil: a.funil,
      dobrados1: a.chave1 === "__outros" ? (modelo?.dobrados ?? []) : null,
      dobrados2: a.chave2 === "__outros" ? (modelo?.seriesDobradas ?? []) : null,
      rotulo: a.rotulo,
    });
  }

  return (
    <article
      draggable={editar}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.id);
        onArrastar(item.id);
      }}
      onDragEnd={() => onArrastar(null)}
      onDragOver={(e) => {
        if (editar && arrastando && arrastando !== item.id) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const origem = e.dataTransfer.getData("text/plain");
        if (origem && origem !== item.id) onSoltar(origem);
      }}
      className={`flex min-w-0 flex-col gap-2 rounded-md border bg-surface p-4 ${CLASSE_DO_TAMANHO[item.tamanho]} ${arrastando === item.id ? "border-accent opacity-60" : "border-border"}`}
    >
      <header className="flex items-start gap-2">
        {editar ? <GripVertical className="mt-1 hidden h-4 w-4 shrink-0 cursor-grab text-text-muted lg:block" aria-hidden="true" /> : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{item.titulo ?? t("Relatório não compartilhado")}</h2>
          <small className={`text-xs ${item.periodoProprio ? "text-accent" : "text-text-muted"}`}>
            {periodoTexto}
            {item.periodoProprio ? ` · ${t("período próprio")}` : ""}
          </small>
        </div>
      </header>
      {!item.config ? (
        <p className="text-sm text-text-muted">{t("Este relatório não está compartilhado com você.")}</p>
      ) : erro ? (
        <p className="text-sm text-text-muted">{t("Este relatório não pôde ser calculado agora.")}</p>
      ) : modelo ? (
        <GraficoDoRelatorio modelo={modelo} vis={vis} compacto onClicar={clicar} />
      ) : (
        <p className="py-6 text-center text-sm text-text-muted">{t("Calculando no banco…")}</p>
      )}
      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-2">
        {editar ? (
          <>
            <div role="group" aria-label={t("Tamanho")} className="flex">
              {TAMANHOS.map((tam) => (
                <button
                  key={tam}
                  type="button"
                  title={t(ROTULO_DO_TAMANHO[tam])}
                  aria-pressed={item.tamanho === tam}
                  onClick={() => onMudar({ tamanho: tam })}
                  className={`min-h-11 min-w-11 border border-border text-sm first:rounded-l-sm last:rounded-r-sm lg:min-h-8 lg:min-w-8 ${item.tamanho === tam ? "bg-accent text-accent-foreground" : "hover:bg-surface-elevated"}`}
                >
                  {tam}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon" aria-label={t("Mover para antes")} disabled={indice === 0} onClick={() => onMover(-1)}>
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t("Mover para depois")} disabled={indice === total - 1} onClick={() => onMover(1)}>
              <ArrowDown aria-hidden="true" />
            </Button>
            <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-0">
              <Switch checked={item.periodoProprio} onCheckedChange={(v) => onMudar({ periodoProprio: v })} />
              {t("Período próprio")}
            </label>
          </>
        ) : null}
        <span className="flex-1" />
        {item.relatorioId || item.pronto ? (
          <Link
            href={item.relatorioId ? `/app/relatorios/editor?id=${item.relatorioId}` : `/app/relatorios/editor?pronto=${item.pronto}`}
            className="inline-flex min-h-11 items-center rounded-sm px-2 text-sm text-accent hover:underline lg:min-h-0"
          >
            {t("Abrir")}
          </Link>
        ) : null}
        {editar ? (
          <Button variant="ghost" size="icon" aria-label={t("Tirar do painel")} onClick={onTirar}>
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

function GerarLink({
  aberto,
  onFechar,
  painelId,
  deFora,
  link,
  onCriado,
  valores,
}: {
  aberto: boolean;
  onFechar: () => void;
  painelId: string;
  deFora: number;
  link: { url: string; validoAte: string } | null;
  onCriado: (l: { url: string; validoAte: string }) => void;
  valores: boolean;
}) {
  const t = useT();
  const [paraQuem, setParaQuem] = useState("");
  const [mostrarValores, setMostrarValores] = useState(valores);
  const [validade, setValidade] = useState<30 | 90 | 365>(90);
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setOcupado(true);
    try {
      const r = await apiClient.post<{ data: { link: { url: string; validoAte: string } } }>("/api/v1/paineis/links", {
        para_quem: paraQuem.trim() || t("Dono do negócio"),
        painel_id: painelId,
        paineis: [],
        periodo: "escolhe",
        mostrar_valores: mostrarValores,
        validade_dias: validade,
      });
      // A validade como a tela mostra (dd/mm/aaaa); o servidor manda o instante.
      onCriado({ url: r.data.link.url, validoAte: new Date(r.data.link.validoAte).toLocaleDateString("pt-BR") });
      toast.success(t("Link criado. Quem manda ao dono é você."));
    } catch (e) {
      toast.error(mensagemDoErro(e, t));
    } finally {
      setOcupado(false);
    }
  }

  async function copiar() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success(t("Link copiado."));
    } catch {
      toast.error(t("Não deu para copiar. Selecione o endereço e copie."));
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Link para o dono")}</DialogTitle>
          <DialogDescription>
            {t("Um endereço sem senha que mostra este painel ao dono, no celular, só com números somados.")}
          </DialogDescription>
        </DialogHeader>
        {deFora > 0 ? (
          <p className="rounded-sm bg-warning-bg px-3 py-2 text-sm text-warning-fg">
            {deFora} {t("relatórios deste painel mostram pessoas da equipe e ficam fora do link.")}
          </p>
        ) : null}
        {link ? (
          <div className="flex flex-col gap-2">
            <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void copiar()}>{t("Copiar link")}</Button>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-sm hover:bg-surface-elevated lg:min-h-9"
              >
                {t("Ver a página")}
              </a>
              <Link href="/app/paineis/links" className="inline-flex min-h-11 items-center px-2 text-sm text-accent hover:underline lg:min-h-9">
                {t("Revogar ou renovar")}
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("Para quem é")}</span>
              <Input value={paraQuem} onChange={(e) => setParaQuem(e.target.value)} maxLength={120} placeholder={t("Ex.: Dono da empresa")} />
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm lg:min-h-0">
              <Switch checked={mostrarValores} onCheckedChange={setMostrarValores} disabled={!valores} />
              {t("Mostrar valores em reais")}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("Vale por")}</span>
              <select
                className="min-h-11 rounded-sm border border-border bg-bg px-3 text-base lg:min-h-9 lg:text-sm"
                value={validade}
                onChange={(e) => setValidade(Number(e.target.value) as 30 | 90 | 365)}
              >
                <option value={30}>{t("30 dias")}</option>
                <option value={90}>{t("90 dias")}</option>
                <option value={365}>{t("1 ano")}</option>
              </select>
            </label>
            <Button disabled={ocupado} onClick={() => void criar()}>
              {t("Gerar link")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
