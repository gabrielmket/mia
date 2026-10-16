"use client";

/**
 * FORK MIA (.79, empresa única) — a LISTA de empresas, em `/app/companies`.
 *
 * Tela 1 do protótipo aprovado em 15/10/2026: uma lista só, em cima do cadastro
 * do upstream, com a consulta de CNPJ ao cadastrar, as pessoas, os negócios
 * abertos e as obrigações de cada empresa, e o aviso de empresa repetida. Os
 * filtros: todas, com negócio aberto, sem CNPJ e possível duplicada (nome
 * parecido, sem CNPJ). Clicar na linha abre a ficha.
 */
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NovaEmpresa } from "@/components/empresas/NovaEmpresa";
import { useT } from "@/hooks/i18n/useT";
import { useEmpresas, type EmpresaNaLista } from "@/hooks/useEmpresas";
import { formatarCnpj } from "@/lib/empresas/formato";
import type { FiltroDaLista } from "@/lib/empresas/lista";
import { Buildings, MagnifyingGlass, Plus } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

const FILTROS: readonly FiltroDaLista[] = ["todas", "abertos", "semcnpj", "dup"];

export function ListaDeEmpresas() {
  const t = useT();
  // O rótulo de cada filtro, literal por literal (a cerca do espanhol lê a chave).
  const rotulos: Record<FiltroDaLista, string> = {
    todas: t("Todas"),
    abertos: t("Com negócio aberto"),
    semcnpj: t("Sem CNPJ"),
    dup: t("Possível duplicada"),
  };
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroDaLista>("todas");
  const [criando, setCriando] = useState(false);
  const { data, isLoading, isError } = useEmpresas(busca, filtro);
  const empresas = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const daOrganizacao = data?.meta.total_da_organizacao ?? 0;

  return (
    <div className="space-y-4 p-4 md:p-6" data-testid="lista-de-empresas">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("Empresas")}</h1>
          <p className="text-sm text-text-muted">
            {t("Os clientes que são empresa. Cada uma reúne as pessoas, os negócios e as obrigações dela.")}
          </p>
        </div>
        <Button onClick={() => setCriando(true)}>
          <Plus className="mr-2 size-4" aria-hidden />
          {t("Nova empresa")}
        </Button>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative lg:max-w-sm lg:flex-1">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Buscar por nome ou CNPJ")}
            aria-label={t("Buscar")}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("Filtrar a lista")}>
          {FILTROS.map((valor) => (
            <button
              key={valor}
              type="button"
              aria-pressed={filtro === valor}
              onClick={() => setFiltro(valor)}
              className={cn(
                "min-h-11 rounded-full border px-3 text-base lg:min-h-0 lg:py-1 lg:text-xs",
                filtro === valor ? "border-accent bg-accent/10 text-accent" : "border-border text-text-muted hover:text-text",
              )}
            >
              {rotulos[valor]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-muted">{t("Carregando…")}</p>
      ) : isError ? (
        <p className="text-sm text-warning-fg">{t("Não consegui carregar as empresas. Tente de novo em instantes.")}</p>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            {total} {t("de")} {daOrganizacao} {daOrganizacao === 1 ? t("empresa") : t("empresas")}.{" "}
            {t("Clique numa linha para abrir a ficha.")}
          </p>
          {empresas.length === 0 ? (
            <div className="rounded-lg border border-border p-8 text-center text-sm text-text-muted">
              <Buildings className="mx-auto mb-2 size-8 opacity-40" aria-hidden />
              {busca || filtro !== "todas" ? t("Nenhuma empresa com esse filtro.") : t("Nenhuma empresa cadastrada ainda.")}
            </div>
          ) : (
            <>
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Empresa")}</TableHead>
                      <TableHead>{t("CNPJ")}</TableHead>
                      <TableHead>{t("Pessoas")}</TableHead>
                      <TableHead>{t("Negócios abertos")}</TableHead>
                      <TableHead>{t("Obrigações")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {empresas.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <NomeDaLinha empresa={e} />
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">{formatarCnpj(e.cnpj) ?? t("não informado")}</span>
                          {e.receita?.situacao ? (
                            <span className="block text-[11px] text-text-muted">
                              {e.receita.situacao} {t("na Receita")}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Pessoas empresa={e} />
                        </TableCell>
                        <TableCell>{e.negocios_abertos}</TableCell>
                        <TableCell>
                          <Obrigacoes empresa={e} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="space-y-2 lg:hidden">
                {empresas.map((e) => (
                  <li key={e.id} className="rounded-lg border border-border p-3">
                    <NomeDaLinha empresa={e} />
                    <p className="mt-1 text-xs text-text-muted">
                      {[formatarCnpj(e.cnpj) ?? t("sem CNPJ"), e.receita?.situacao ?? null].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-text-muted">{t("Pessoas")}</p>
                        <Pessoas empresa={e} />
                      </div>
                      <div>
                        <p className="text-text-muted">{t("Negócios abertos")}</p>
                        <p>{e.negocios_abertos}</p>
                      </div>
                      <div>
                        <p className="text-text-muted">{t("Obrigações")}</p>
                        <Obrigacoes empresa={e} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {criando ? <NovaEmpresa aoFechar={() => setCriando(false)} /> : null}
    </div>
  );
}

function NomeDaLinha({ empresa: e }: { empresa: EmpresaNaLista }) {
  const t = useT();
  return (
    <div className="min-w-0">
      <Link href={`/app/companies/${e.id}`} className="inline-flex min-h-11 items-center font-medium text-text hover:underline lg:min-h-0">
        {e.nome}
      </Link>
      <p className="truncate text-[11px] text-text-muted">{e.razao_social ?? t("Razão social não informada")}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {e.parece_com ? (
          <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[11px] text-warning-fg">
            {t("Parece")} {e.parece_com.nome}
          </span>
        ) : null}
        {!e.cnpj ? (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-text-muted">{t("Sem CNPJ")}</span>
        ) : null}
      </div>
    </div>
  );
}

function Pessoas({ empresa: e }: { empresa: EmpresaNaLista }) {
  const t = useT();
  if (e.pessoas.total === 0) return <span className="text-text-muted">0</span>;
  const mostrar = e.pessoas.nomes.slice(0, 2).join(", ");
  const resto = e.pessoas.total - Math.min(2, e.pessoas.nomes.length);
  return (
    <span>
      {e.pessoas.total}
      {mostrar ? (
        <span className="block text-[11px] text-text-muted">
          {mostrar}
          {resto > 0 ? ` ${t("e mais")} ${resto}` : ""}
        </span>
      ) : null}
    </span>
  );
}

function Obrigacoes({ empresa: e }: { empresa: EmpresaNaLista }) {
  const t = useT();
  if (e.obrigacoes.atencao > 0) {
    return (
      <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[11px] text-warning-fg">
        {e.obrigacoes.atencao} {t("pedindo atenção")}
      </span>
    );
  }
  if (e.obrigacoes.total > 0) {
    return (
      <span className="rounded-full bg-success-bg px-2 py-0.5 text-[11px] text-success-fg">
        {e.obrigacoes.total} {t("em dia")}
      </span>
    );
  }
  return <span className="text-[11px] text-text-muted">{t("nenhuma")}</span>;
}
