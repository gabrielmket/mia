"use client";

/**
 * FORK MIA (item 9) — a lista de relatórios (protótipo, tela 1): abas Prontos
 * e Meus relatórios, a busca que filtra as duas juntas, copiar um pronto (a
 * cópia aparece em Meus relatórios e o original continua igual) e copiar o
 * relatório compartilhado de outra pessoa para mexer.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { apagar, criar, mensagemDoErro } from "@/components/relatorios/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { FONTES_DO_MONTADOR, ROTULO_DA_VISUALIZACAO, ROTULO_DO_PERIODO_DO_MONTADOR, rotuloDaDimensao } from "@/lib/relatorios/catalogo";
import type { ConfigDoRelatorio } from "@/lib/relatorios/config";

interface Pronto {
  chave: string;
  nome: string;
  pergunta: string;
  config: ConfigDoRelatorio;
}

interface Meu {
  id: string;
  nome: string;
  config: ConfigDoRelatorio;
  compartilhado: boolean;
  atualizadoEm: string;
  meu: boolean;
  criadoPorNome: string | null;
  podeEditar: boolean;
}

interface Props {
  prontos: Pronto[];
  relatorios: Meu[];
  permissoes: { compartilhar: boolean; exportar: boolean };
}

function semAcento(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function Chip({ children, destaque = false }: { children: React.ReactNode; destaque?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${destaque ? "bg-accent-soft text-accent" : "bg-surface-elevated text-text-muted"}`}>
      {children}
    </span>
  );
}

export function ListaDeRelatorios({ prontos, relatorios, permissoes }: Props) {
  const t = useT();
  const router = useRouter();
  const [aba, setAba] = useState<"prontos" | "meus">("prontos");
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);

  const casa = (texto: string) => !busca.trim() || semAcento(texto).includes(semAcento(busca.trim()));
  const textoDe = (c: ConfigDoRelatorio) => `${t(FONTES_DO_MONTADOR[c.fonte].nome)} ${c.dim1 ? t(rotuloDaDimensao(c.fonte, c.dim1)) : ""}`;
  const filtrados = useMemo(
    () => ({
      prontos: prontos.filter((p) => casa(`${t(p.nome)} ${t(p.pergunta)} ${textoDe(p.config)}`)),
      meus: relatorios.filter((r) => casa(`${r.nome} ${r.criadoPorNome ?? ""} ${textoDe(r.config)}`)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busca, prontos, relatorios, t],
  );
  const lista = aba === "prontos" ? filtrados.prontos : filtrados.meus;
  const outra = aba === "prontos" ? filtrados.meus.length : filtrados.prontos.length;

  async function copiar(config: ConfigDoRelatorio, nome: string, origem: { pronto?: string; relatorio?: string }) {
    setOcupado(origem.pronto ?? origem.relatorio ?? null);
    try {
      const novo = await criar({
        nome: `${t("Cópia de")} ${nome}`.slice(0, 80),
        config,
        pronto_de: origem.pronto ?? null,
        copiado_de: origem.relatorio ?? null,
      });
      toast.success(origem.pronto ? t("Cópia salva em Meus relatórios. O pronto continua igual.") : t("Cópia salva em Meus relatórios."));
      router.push(`/app/relatorios/editor?id=${novo.id}`);
    } catch (e) {
      toast.error(mensagemDoErro(e, t));
    } finally {
      setOcupado(null);
    }
  }

  async function remover(r: Meu) {
    if (!window.confirm(`${t("Apagar o relatório")} "${r.nome}"?`)) return;
    try {
      await apagar(r.id);
      toast.success(t("Relatório apagado."));
      router.refresh();
    } catch (e) {
      toast.error(mensagemDoErro(e, t));
    }
  }

  const detalhe = (c: ConfigDoRelatorio) => (
    <div className="flex flex-wrap gap-1">
      <Chip>{t(FONTES_DO_MONTADOR[c.fonte].nome)}</Chip>
      <Chip>{t(ROTULO_DA_VISUALIZACAO[c.visualizacao])}</Chip>
      <Chip>{t(ROTULO_DO_PERIODO_DO_MONTADOR[c.periodo])}</Chip>
    </div>
  );

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Relatórios")}</h1>
          <p className="text-sm text-text-muted">
            {t("Os doze painéis prontos viram relatórios prontos: abrem, copiam e editam. Ao lado, os relatórios que a equipe montou.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/relatorios/paineis"
            className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
          >
            {t("Meus painéis")}
          </Link>
          {permissoes.exportar ? (
            <Link
              href="/app/relatorios/exportacoes"
              className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
            >
              {t("Registro de exportações")}
            </Link>
          ) : null}
          <Link
            href="/app/relatorios/novo"
            // FORK MIA (.93): marcador do "Me mostra como" (lib/assistente/trilhas/catalogo.ts).
            data-testid="novo-relatorio"
            className="inline-flex min-h-11 items-center rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 lg:min-h-9"
          >
            {t("Novo relatório")}
          </Link>
        </div>
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="tablist" aria-label={t("Relatórios")} className="flex gap-1">
          {(["prontos", "meus"] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={aba === a}
              onClick={() => setAba(a)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-sm px-4 text-base lg:min-h-9 lg:text-sm ${aba === a ? "bg-accent-soft font-medium text-accent" : "hover:bg-surface-elevated"}`}
            >
              {a === "prontos" ? t("Prontos") : t("Meus relatórios")}
              <span className="rounded-full bg-surface-elevated px-2 text-xs text-text-muted">{filtrados[a].length}</span>
            </button>
          ))}
        </div>
        <label className="w-full md:w-80">
          <span className="sr-only">{t("Buscar relatório")}</span>
          <Input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t("Buscar por nome, pergunta ou fonte")} />
        </label>
      </div>

      <p className="text-sm text-text-muted">
        {aba === "prontos"
          ? t("Os mesmos doze painéis do mês, agora abertos: dá para ver a conta, copiar e mudar o que quiser. O original nunca muda.")
          : t("Os seus e os que alguém compartilhou com a equipe. Relatório que alguém guardou só para si não aparece aqui. Os números de cada um são os que você já vê no CRM.")}
      </p>

      {lista.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-md border border-border p-4 text-sm">
          <span>
            {busca ? `${t("Nenhum relatório com a busca nesta aba.")}${outra ? ` ${t("Há")} ${outra} ${t("na outra aba.")}` : ""}` : t("Nenhum relatório ainda. Comece por um pronto ou por um novo.")}
          </span>
          {busca ? (
            <Button variant="outline" size="sm" onClick={() => setBusca("")}>
              {t("Limpar a busca")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {aba === "prontos"
            ? filtrados.prontos.map((p) => (
                <article key={p.chave} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
                  <div className="min-w-0">
                    <h2 className="font-semibold">{p.nome}</h2>
                    <p className="text-sm text-text-muted">{t(p.pergunta)}</p>
                  </div>
                  {detalhe(p.config)}
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Link
                      href={`/app/relatorios/editor?pronto=${p.chave}`}
                      className="inline-flex min-h-11 items-center rounded-sm border border-border px-3 text-sm hover:bg-surface-elevated lg:min-h-8"
                    >
                      {t("Abrir")}
                    </Link>
                    <Button variant="outline" size="sm" disabled={ocupado === p.chave} onClick={() => void copiar(p.config, p.nome, { pronto: p.chave })}>
                      {t("Copiar e editar")}
                    </Button>
                  </div>
                </article>
              ))
            : filtrados.meus.map((r) => (
                <article key={r.id} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
                  <div className="min-w-0">
                    <h2 className="font-semibold">{r.nome}</h2>
                    <p className="text-sm text-text-muted">
                      {t("Criado por")} {r.meu ? t("você") : (r.criadoPorNome ?? t("Pessoa fora da equipe"))} ·{" "}
                      {r.atualizadoEm}
                    </p>
                  </div>
                  {detalhe(r.config)}
                  <div className="flex flex-wrap gap-1">
                    {r.compartilhado ? <Chip destaque>{t("Compartilhado com a equipe")}</Chip> : <Chip>{r.meu ? t("Só para você") : t("Só da pessoa")}</Chip>}
                    {!r.podeEditar ? <Chip>{t("Só leitura: copie para mexer")}</Chip> : null}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Link
                      href={`/app/relatorios/editor?id=${r.id}`}
                      className="inline-flex min-h-11 items-center rounded-sm border border-border px-3 text-sm hover:bg-surface-elevated lg:min-h-8"
                    >
                      {t("Abrir")}
                    </Link>
                    <Button variant="outline" size="sm" disabled={ocupado === r.id} onClick={() => void copiar(r.config, r.nome, { relatorio: r.id })}>
                      {t("Copiar")}
                    </Button>
                    {r.podeEditar ? (
                      <Button variant="ghost" size="sm" onClick={() => void remover(r)}>
                        {t("Apagar")}
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
        </div>
      )}
    </div>
  );
}
