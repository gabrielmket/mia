"use client";

/**
 * O NÚMERO QUE AVISA O TIME — e quem recebe o aviso em cada cliente.
 *
 * Duas decisões moram nesta tela porque são uma só na cabeça de quem opera:
 * conectar o número, e dizer para qual grupo ele fala em cada empresa. Separar
 * em duas telas faria o segundo passo ser esquecido — e um cliente com aviso
 * desligado é indistinguível, de fora, de um cliente sem lead qualificado.
 *
 * ⚠️ A saúde do número vem primeiro, e em destaque: ele é ponto único de falha
 * da instalação inteira. Se cair, NINGUÉM recebe aviso. Enterrar o estado num
 * rodapé é o que transforma uma queda de dez minutos numa semana sem aviso.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import {
  useDefinirGrupoDaEmpresa,
  useMarcarNumeroDeAvisos,
  useNumeroDeAvisos,
  type EmpresaComGrupo,
  type GrupoDeAvisos,
} from "@/hooks/useNumeroDeAvisos";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";

/** Valor do item "não avisar" — `Select` não aceita valor vazio. */
const SEM_GRUPO = "__sem_grupo__";

function LinhaDaEmpresa({
  empresa,
  grupos,
  podeEscolher,
}: {
  empresa: EmpresaComGrupo;
  grupos: GrupoDeAvisos[];
  podeEscolher: boolean;
}) {
  const t = useT();
  const definir = useDefinirGrupoDaEmpresa();

  /**
   * O grupo salvo entra na lista mesmo que o WhatsApp não o tenha devolvido.
   *
   * Sem isso, um grupo do qual o número foi removido sumiria do `Select` e a
   * tela mostraria "não avisar" — dizendo que a configuração não existe quando
   * na verdade ela existe e está quebrada. São problemas diferentes: o primeiro
   * se resolve escolhendo, o segundo readicionando o número ao grupo.
   */
  const opcoes = empresa.grupo && !grupos.some((g) => g.id === empresa.grupo?.id)
    ? [empresa.grupo, ...grupos]
    : grupos;

  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 font-medium">{empresa.display_name}</p>
      <Select
        value={empresa.grupo?.id ?? SEM_GRUPO}
        disabled={!podeEscolher || definir.isPending}
        onValueChange={(v) =>
          definir.mutate({
            organization_id: empresa.id,
            grupo: v === SEM_GRUPO ? null : (opcoes.find((g) => g.id === v) ?? null),
          })
        }
      >
        <SelectTrigger className="sm:w-80" aria-label={t("Grupo que recebe o aviso")}>
          <SelectValue placeholder={t("Sem aviso")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM_GRUPO}>{t("Sem aviso")}</SelectItem>
          {opcoes.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function NumeroDeAvisos() {
  const t = useT();
  const { data, isLoading, error } = useNumeroDeAvisos();
  const marcar = useMarcarNumeroDeAvisos();
  const [escolhida, setEscolhida] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar o número de avisos agora.")}</p>;
  }

  const saudavel = data.sessao?.status === STATUS_SAUDAVEL;
  const candidatas = data.candidatas.filter((c) => c.id !== data.sessao?.id);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("Número que avisa os grupos")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-text-muted">
            {t(
              "Um número só para toda a plataforma. Conecte-o como um canal comum e adicione-o aos grupos dos clientes; é por ele que sai o aviso de lead qualificado.",
            )}
          </p>

          {data.sessao ? (
            <div className="rounded-md border border-border p-4">
              <p className="font-medium">
                {data.sessao.display_name ?? data.sessao.phone_number}
              </p>
              <p className="text-sm text-text-muted">
                {data.sessao.phone_number} · {data.sessao.organizacao}
              </p>
              <p className={saudavel ? "mt-2 text-sm text-text-muted" : "mt-2 text-sm font-medium text-error-fg"}>
                {saudavel
                  ? t("Conectado.")
                  : t("FORA DO AR — enquanto estiver assim, nenhum cliente recebe aviso.")}
              </p>
              <Button
                variant="secondary"
                className="mt-3"
                disabled={marcar.isPending}
                onClick={() => marcar.mutate(null)}
              >
                {t("Desmarcar")}
              </Button>
            </div>
          ) : (
            <p className="text-sm font-medium text-error-fg">
              {t("Nenhum número marcado — nenhum cliente recebe aviso no grupo.")}
            </p>
          )}

          {candidatas.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="numero-de-avisos-candidata">
                {data.sessao ? t("Trocar pelo número") : t("Usar este número")}
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={escolhida ?? ""} onValueChange={setEscolhida}>
                  <SelectTrigger id="numero-de-avisos-candidata" className="sm:w-96">
                    <SelectValue placeholder={t("Escolha um número conectado")} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidatas.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {`${c.display_name ?? c.phone_number ?? c.id} · ${c.organizacao ?? ""}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!escolhida || marcar.isPending}
                  onClick={() =>
                    escolhida &&
                    // Limpa a escolha ao confirmar: o número marcado sai da lista
                    // de candidatas, e um valor que não está mais entre as opções
                    // deixa o seletor mostrando vazio como se nada tivesse sido
                    // feito — logo depois de o operador ter feito.
                    marcar.mutate(escolhida, { onSuccess: () => setEscolhida(null) })
                  }
                >
                  {t("Confirmar")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Quem recebe em cada cliente")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.sessao ? (
            <p className="text-sm text-text-muted">
              {t("Marque o número acima para escolher os grupos.")}
            </p>
          ) : (
            <>
              {data.grupos_indisponiveis && (
                <p className="mb-3 text-sm font-medium text-error-fg">
                  {t(
                    "Não consegui perguntar ao WhatsApp quais são os grupos. O que já estava escolhido continua valendo.",
                  )}
                </p>
              )}
              {!data.grupos_indisponiveis && data.grupos.length === 0 && (
                <p className="mb-3 text-sm text-text-muted">
                  {t("Este número ainda não está em nenhum grupo. Adicione-o pelo WhatsApp e recarregue.")}
                </p>
              )}
              <div>
                {data.empresas.map((e) => (
                  <LinhaDaEmpresa
                    key={e.id}
                    empresa={e}
                    grupos={data.grupos}
                    podeEscolher={!data.grupos_indisponiveis}
                  />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
