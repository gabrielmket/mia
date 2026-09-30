"use client";

/**
 * FORK MIA (.61) — PÁGINAS DA META: de qual empresa é cada uma.
 *
 * O token da agência alcança as Páginas de vários clientes. A empresa só vê, e
 * só importa formulário, das Páginas que estão aqui no nome dela; Página sem
 * dono não aparece para ninguém (migration 9004, docs/fork/leads-da-meta.md).
 *
 * Dois quadros, na ordem em que se configura:
 *
 *   1. a CONEXÃO: qual empresa empresta o token de Meta Ads para ler as Páginas
 *      de quem não tem token próprio (a Time Company);
 *   2. as PÁGINAS que esse token alcança, cada uma com o seu dono.
 *
 * ⚠️ A atribuição é DELIBERADAMENTE manual, pela mesma razão do cadastro
 * incorporado: nada na resposta da Meta diz de qual cliente nosso é a Página, e
 * errar põe os leads de um cliente no funil de outro.
 *
 * .64 (migration 9008): a empresa com a própria conta da Meta também assume as
 * Páginas que a conta dela alcança. Cada dono mostra a ORIGEM (atribuída pela
 * plataforma ou assumida pela empresa), e daqui se transfere ou corrige
 * qualquer uma — o que a plataforma grava é sempre da plataforma.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import {
  useAtribuirPagina,
  useEscolherConexaoDaPlataforma,
  usePaginasDaMeta,
  useRetirarDonoDaPagina,
  type PaginaNoPainel,
} from "@/hooks/usePaginasDaMeta";

/** O valor do seletor que quer dizer "nenhuma empresa" (o Select não aceita string vazia). */
const NENHUMA = "__nenhuma__";

const MENSAGEM_DA_FALHA: Record<string, string> = {
  sem_conexao: "A empresa escolhida não tem mais conexão de Meta Ads. Conecte o token em Configurações › Meta Ads dela.",
  cifra_indisponivel:
    "A chave de criptografia do servidor não está disponível para ler o token. É configuração do servidor.",
  token_invalido:
    "A Meta recusou o token: ele expirou ou foi revogado. Gere um novo no Gerenciador de Negócios e cole em Configurações › Meta Ads da empresa escolhida.",
  permissao_insuficiente: "O token não tem permissão para listar as Páginas (pages_show_list).",
  limite_de_chamadas: "A Meta limitou as chamadas por excesso de consultas. Tente de novo em alguns minutos.",
  transitorio: "Não foi possível falar com a Meta agora. Tente de novo em instantes.",
  campo_invalido: "A Meta recusou um campo da consulta. É problema do sistema, não da conta.",
};

export function PaginasDaMeta() {
  const t = useT();
  const { data, isLoading, error } = usePaginasDaMeta();
  const escolher = useEscolherConexaoDaPlataforma();

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return (
      <p role="alert" className="text-sm text-error-fg">
        {t("Não consegui carregar as Páginas da Meta agora.")}
      </p>
    );
  }

  const conexao = data.conexao.organizacao_da_conexao;
  const semDono = data.paginas.filter((p) => !p.organization_id);
  const comDono = data.paginas.filter((p) => p.organization_id);

  return (
    <div className="space-y-6" data-testid="tela-paginas-da-meta">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Páginas da Meta")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          {t(
            "Cada Página da Meta é de uma empresa só, e a empresa vê e importa os formulários apenas das Páginas dela. Quem lê pela conexão da plataforma recebe as Páginas atribuídas aqui; a empresa com a própria conta da Meta conectada também marca as Páginas que essa conta alcança. Daqui se transfere ou corrige qualquer Página.",
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("Conexão da plataforma")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-text-muted">
            {t(
              "O token de Meta Ads desta empresa lê as Páginas atribuídas a quem não tem token próprio, e só elas. Normalmente é a empresa da agência.",
            )}
          </p>
          <Select
            value={conexao ?? NENHUMA}
            disabled={escolher.isPending}
            onValueChange={(v) => escolher.mutate(v === NENHUMA ? null : v)}
          >
            <SelectTrigger className="sm:w-96" aria-label={t("Empresa que empresta a conexão")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUMA}>{t("Nenhuma: cada empresa usa o próprio token")}</SelectItem>
              {data.empresas_com_conexao.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data.empresas_com_conexao.length === 0 && (
            <p className="text-sm text-text-muted">
              {t("Nenhuma empresa tem conexão de Meta Ads. Conecte o token em Configurações › Meta Ads de uma empresa.")}
            </p>
          )}
          {data.permissoes?.verificadas && data.permissoes.faltandoObrigatorias.length > 0 && (
            <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
              <p className="font-medium">{t("Faltam permissões no token, e sem elas nenhum lead é lido:")}</p>
              <p className="mt-1">
                {data.permissoes.faltandoObrigatorias.map((p) => (
                  <code key={p} className="mr-2">
                    {p}
                  </code>
                ))}
              </p>
            </div>
          )}
          {data.erro && (
            <p role="alert" className="text-sm text-error-fg">
              {t(MENSAGEM_DA_FALHA[data.erro.falha] ?? "Não consegui carregar agora.")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Páginas e donos")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!conexao && comDono.length === 0 && (
            <p className="text-sm text-text-muted">
              {t("Escolha a conexão da plataforma acima para ver as Páginas que o token alcança.")}
            </p>
          )}
          {conexao && !data.erro && data.paginas.length === 0 && (
            <p className="text-sm text-text-muted">
              {t(
                "O token não alcança nenhuma Página. No Gerenciador de Negócios, atribua a Página ao usuário do sistema do token (Usuários do sistema › Atribuir ativos › Páginas).",
              )}
            </p>
          )}
          {semDono.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{t("Sem dono")}</h3>
              {semDono.map((p) => (
                <LinhaDaPagina key={p.id} pagina={p} empresas={data.empresas} />
              ))}
            </div>
          )}
          {comDono.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{t("Atribuídas")}</h3>
              {comDono.map((p) => (
                <LinhaDaPagina key={p.id} pagina={p} empresas={data.empresas} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LinhaDaPagina({
  pagina,
  empresas,
}: {
  pagina: PaginaNoPainel;
  empresas: Array<{ id: string; display_name: string }>;
}) {
  const t = useT();
  const atribuir = useAtribuirPagina();
  const retirar = useRetirarDonoDaPagina();
  const [destino, setDestino] = useState<string>(pagina.organization_id ?? "");
  const mudou = Boolean(destino) && destino !== pagina.organization_id;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{pagina.nome}</p>
        <p className="text-xs text-text-muted">
          {pagina.id}
          {pagina.organizacao && <> · {pagina.organizacao}</>}
          {pagina.origem === "conta_propria" && <> · {t("assumida pela empresa")}</>}
          {pagina.origem === "plataforma" && <> · {t("atribuída pela plataforma")}</>}
          {!pagina.alcancada &&
            (pagina.origem === "conta_propria" ? (
              <> · {t("lida pela conta da Meta da própria empresa")}</>
            ) : (
              <> · {t("o token não alcança mais esta Página")}</>
            ))}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={destino} onValueChange={setDestino}>
          <SelectTrigger className="sm:w-64" aria-label={t("De qual empresa é esta Página")}>
            <SelectValue placeholder={t("De qual empresa é esta Página?")} />
          </SelectTrigger>
          <SelectContent>
            {empresas.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={!mudou || atribuir.isPending}
          onClick={() =>
            atribuir.mutate({ page_id: pagina.id, page_name: pagina.nome, organization_id: destino })
          }
        >
          {pagina.organization_id ? t("Trocar dono") : t("Atribuir")}
        </Button>
        {pagina.organization_id && (
          <Button
            variant="outline"
            disabled={retirar.isPending}
            onClick={() => retirar.mutate(pagina.id)}
          >
            {t("Retirar dono")}
          </Button>
        )}
      </div>
    </div>
  );
}
