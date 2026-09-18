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
import { useEffect, useState } from "react";

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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  useDefinirGrupoDaEmpresa,
  useMarcarNumeroDeAvisos,
  useConectarNumeroDeAvisos,
  useNumeroDeAvisos,
  useSalvarReport,
  type ConfiguracaoDoReport,
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

/**
 * O grupo INTERNO, o limite do saldo e a chave do resumo.
 *
 * Os três juntos num cartão só porque são uma decisão só: "quero ser avisado, e
 * a partir de quanto". Separar o limite numa tela de configuração faria o
 * operador ligar o report e descobrir o número padrão no dia em que ele
 * disparasse — cedo ou tarde demais.
 */
function CartaoDoReport({
  report,
  grupos,
  podeEscolher,
}: {
  report: ConfiguracaoDoReport;
  grupos: GrupoDeAvisos[];
  podeEscolher: boolean;
}) {
  const t = useT();
  const salvar = useSalvarReport();
  const [limite, setLimite] = useState<string | null>(null);

  const opcoes =
    report.grupo && !grupos.some((g) => g.id === report.grupo?.id)
      ? [report.grupo, ...grupos]
      : grupos;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="grupo-do-report">{t("Grupo que recebe")}</Label>
        <Select
          value={report.grupo?.id ?? SEM_GRUPO}
          disabled={!podeEscolher || salvar.isPending}
          onValueChange={(v) =>
            salvar.mutate({
              grupo: v === SEM_GRUPO ? null : (opcoes.find((g) => g.id === v) ?? null),
            })
          }
        >
          <SelectTrigger id="grupo-do-report" className="sm:w-80">
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

      <div className="space-y-1">
        <Label htmlFor="limite-do-saldo">{t("Avisar quando o crédito de IA cair abaixo de (US$)")}</Label>
        <div className="flex gap-2">
          <Input
            id="limite-do-saldo"
            className="sm:w-40"
            value={limite ?? String(report.limite_saldo_usd)}
            onChange={(e) => setLimite(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={salvar.isPending || limite === null}
            onClick={() =>
              salvar.mutate(
                { grupo: report.grupo, limite_saldo_usd: Number(limite) },
                { onSuccess: () => setLimite(null) },
              )
            }
          >
            {t("Salvar")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="resumo-diario"
          checked={report.resumo_diario}
          disabled={salvar.isPending}
          onCheckedChange={(v) => salvar.mutate({ grupo: report.grupo, resumo_diario: v })}
        />
        <Label htmlFor="resumo-diario">{t("Mandar o resumo do dia, às 8h")}</Label>
      </div>
    </div>
  );
}

/**
 * PAREAR UM NÚMERO NOVO, aqui mesmo.
 *
 * Antes era preciso conectar dentro da tela de Conexões de algum cliente e só
 * então voltar para marcar — dois passos onde a cabeça de quem implanta enxerga
 * um, e o primeiro no lugar errado.
 *
 * O QR se atualiza sozinho a cada 3 segundos porque ele EXPIRA em segundos do
 * lado do WhatsApp. Um código parado na tela é recusado pelo celular sem dizer
 * por quê, e a pessoa conclui que o sistema está quebrado.
 */
function PareamentoDeNumero({ empresas }: { empresas: EmpresaComGrupo[] }) {
  const t = useT();
  const conectar = useConectarNumeroDeAvisos();
  const [org, setOrg] = useState<string | null>(null);
  const [pareando, setPareando] = useState(false);
  const [tique, setTique] = useState(0);

  useEffect(() => {
    if (!pareando) return;
    const id = setInterval(() => setTique((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, [pareando]);

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <p className="font-medium">{t("Conectar um número novo")}</p>
      <p className="text-sm text-text-muted">
        {t(
          "O número precisa morar em uma das organizações (normalmente a sua) — é assim que ele entra no vigia de saúde e na reconexão. O papel de número de avisos é da plataforma; a organização é só o endereço dele.",
        )}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={org ?? ""} onValueChange={setOrg}>
          <SelectTrigger className="sm:w-80" aria-label={t("Organização do número")}>
            <SelectValue placeholder={t("Em qual organização ele fica?")} />
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
          disabled={!org || conectar.isPending}
          onClick={() =>
            org &&
            conectar.mutate(
              { organization_id: org },
              { onSuccess: () => setPareando(true) },
            )
          }
        >
          {t("Conectar e mostrar o QR")}
        </Button>
      </div>

      {pareando && (
        <div className="space-y-2">
          <p className="text-sm">
            {t("Abra o WhatsApp do número, vá em Aparelhos conectados e leia o código:")}
          </p>
          {/* A chave NÃO entra no <img>: trocar a chave remonta o elemento e o
              navegador pisca um vazio a cada 3 segundos. Só a URL muda. */}
          <img
            src={`/api/v1/admin/numero-de-avisos/qr?t=${tique}`}
            alt={t("Código QR")}
            className="h-64 w-64 rounded-md bg-white p-2"
          />
          <p className="text-xs text-text-muted">
            {t("Assim que o celular ler, recarregue esta página: o número aparece marcado acima.")}
          </p>
        </div>
      )}
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

          <PareamentoDeNumero empresas={data.empresas} />

          {candidatas.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="numero-de-avisos-candidata">
                {data.sessao ? t("Trocar pelo número") : t("Ou usar um número já conectado")}
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

      {data.sessao && (
        <Card>
          <CardHeader>
            <CardTitle>{t("Report interno (o nosso grupo)")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-text-muted">
              {t(
                "O mesmo número, falando com a gente: crédito de IA acabando, número fora do ar e um resumo por dia. Cada aviso sai no máximo uma vez por dia enquanto o problema durar.",
              )}
            </p>
            <CartaoDoReport
              report={data.report}
              grupos={data.grupos}
              podeEscolher={!data.grupos_indisponiveis}
            />
          </CardContent>
        </Card>
      )}

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
