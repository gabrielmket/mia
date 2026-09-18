"use client";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useConnectOfficialChannel,
  useOfficialChannel,
} from "@/hooks/channels/useOfficialChannel";
import { copyToClipboard } from "@/lib/clipboard";
import { useT } from "@/hooks/i18n/useT";
import { ChannelAiAccess } from "./ChannelAiAccess";

/** Campo somente-leitura com botão de copiar — o que o operador cola na Meta. */
function ParaColar({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  const t = useT();
  if (!valor) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {rotulo}
        </span>
        <span className="text-sm text-destructive">
          {t("não configurado nesta instalação — defina no servidor antes de continuar")}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-md bg-muted px-2 py-1.5 text-xs">{valor}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await copyToClipboard(valor);
            toast.success(t("Copiado."));
          }}
        >
          {t("Copiar")}
        </Button>
      </div>
    </div>
  );
}

export function CanalOficialClient() {
  const t = useT();
  const { data, isPending } = useOfficialChannel();
  const conectar = useConnectOfficialChannel();
  const [form, setForm] = useState({ phone_number_id: "", waba_id: "", token: "" });

  const estado = data?.data;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const r = await conectar.mutateAsync(form);
    toast.success(`${t("Conectado:")} ${r.data.displayName} ${r.data.phoneNumber ?? ""}`.trim());
    // O token some do formulário assim que grava — deixá-lo na tela seria mantê-lo
    // em memória do navegador sem motivo, e ele não volta em nenhum GET.
    setForm((f) => ({ ...f, token: "" }));
  }

  if (isPending) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  return (
    <div className="flex flex-col gap-4" data-testid="canal-oficial-root">
      {/*
        O AVISO VEM PRIMEIRO, e vem antes até do cartão de "conectado".

        Sem os dois segredos de servidor, a Meta ENTREGA e nós recusamos: todo
        POST morre em 401 de assinatura, sem linha no inbox e sem erro nenhum
        na tela. O operador vê "conectado", manda um "oi" do celular, não recebe
        nada e vai procurar defeito no número — que é o único lugar onde o
        defeito não está.

        A checagem já existia em `lib/channels/meta/webhook.ts`, com este modo
        de falha escrito por extenso, e só era consultada no ONBOARDING. Quem
        conecta um número meses depois — o caso normal, e o de quem troca de
        número — nunca a via.
      */}
      {estado && estado.podeReceber === false ? (
        <Card className="border-destructive p-4" data-testid="canal-oficial-nao-recebe">
          <h2 className="font-medium text-destructive">
            {t("Este canal envia, mas NÃO recebe")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Falta segredo no servidor. A Meta vai entregar as respostas e o sistema vai recusar todas, sem erro visível: o cliente responde e a mensagem não aparece em lugar nenhum.",
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {(estado.faltaNoAmbiente ?? []).map((nome) => (
              <Badge key={nome} variant="destructive" className="font-mono text-xs">
                {nome}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("Defina no .env do servidor e reinicie o app.")}
          </p>
        </Card>
      ) : null}

      {estado?.connected ? (
        <Card className="p-4" data-testid="canal-conectado">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{estado.displayName}</span>
            {estado.phoneNumber ? (
              <Badge variant="outline" className="font-mono text-xs">
                {estado.phoneNumber}
              </Badge>
            ) : null}
            <Badge>{estado.status ?? "—"}</Badge>
            {/* Mostra que o token EXISTE, nunca qual é. */}
            <Badge variant={estado.hasToken ? "outline" : "destructive"}>
              {estado.hasToken ? t("credencial guardada") : t("sem credencial")}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            WABA <span className="font-mono">{estado.wabaId}</span> · {t("número")}{" "}
            <span className="font-mono">{estado.phoneNumberId}</span>
          </p>
        </Card>
      ) : null}
      {estado?.channel_session_id && <ChannelAiAccess channelId={estado.channel_session_id} />}

      {estado?.webhook ? (
        <Card className="flex flex-col gap-3 p-4">
          <div>
            <h2 className="font-medium">{t("Cole isto no painel da Meta")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Em")} <strong>WhatsApp → {t("Configuração")}</strong>
              {t(", na seção de Webhook. Sem esse passo o canal envia, mas")}{" "}
              <strong>{t("não recebe")}</strong>
              {t(" — as respostas do cliente não chegam e a janela de 24 horas nunca abre.")}
            </p>
          </div>
          <ParaColar rotulo={t("URL de callback")} valor={estado.webhook.callbackUrl} />
          <ParaColar rotulo={t("Token de verificação")} valor={estado.webhook.verifyToken} />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("Campos a assinar")}
            </span>
            <div className="flex flex-wrap gap-1">
              {estado.webhook.fields.map((f) => (
                <Badge key={f} variant="outline" className="font-mono text-xs">
                  {f}
                </Badge>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      {/*
        AS DUAS PORTAS, lado a lado.

        A de cima só aparece quando a plataforma configurou o link do cadastro
        incorporado; sem ele, a tela é exatamente a de antes. Ausência esconde a
        porta — um botão "Conectar com o Facebook" que leva a lugar nenhum custa
        mais confiança do que a sua falta.

        A manual NUNCA some, mesmo com a porta do login disponível: o cadastro
        incorporado depende da análise do app na Meta e de a conta do cliente
        estar em ordem, e quando ele travar — e vai travar em algum cliente — a
        porta manual é o que evita "volto semana que vem".
      */}
      {!estado?.connected && estado?.embedded_signup_url ? (
        <Card className="p-4">
          <h2 className="font-medium">{t("Conectar com o Facebook")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "O jeito rápido: você entra com a conta do Facebook da sua empresa e escolhe o número por lá. Nada para copiar e colar.",
            )}
          </p>
          <Button className="mt-3" onClick={() => window.open(estado.embedded_signup_url ?? "", "_blank", "noopener")}>
            {t("Entrar com o Facebook")}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("Quando terminar, avise a gente: o número aparece aqui depois que a Meta confirmar.")}
          </p>
        </Card>
      ) : null}

      <Card className="p-4">
        <h2 className="font-medium">
          {estado?.connected
            ? t("Trocar credencial")
            : estado?.embedded_signup_url
              ? t("Ou configurar manualmente")
              : t("Conectar canal oficial")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Os três valores vêm do seu app na Meta (")}
          <strong>WhatsApp → {t("Configuração da API")}</strong>
          {t("). A credencial é")} <strong>{t("validada com a Meta antes de ser gravada")}</strong>
          {t(" — se o número não responder, nada é salvo.")}
        </p>

        <form onSubmit={enviar} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pnid">{t("ID do número de telefone")}</Label>
            <Input
              id="pnid"
              value={form.phone_number_id}
              onChange={(e) => setForm((f) => ({ ...f, phone_number_id: e.target.value }))}
              placeholder="1103328999528818"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="waba">{t("ID da conta do WhatsApp Business")}</Label>
            <Input
              id="waba"
              value={form.waba_id}
              onChange={(e) => setForm((f) => ({ ...f, waba_id: e.target.value }))}
              placeholder="2434045433735175"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tok">{t("Token de acesso")}</Label>
            <Input
              id="tok"
              type="password"
              value={form.token}
              onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
              placeholder={
                estado?.hasToken ? t("•••• (já guardado — preencha para trocar)") : "EAAG…"
              }
              required
            />
            <span className="text-xs text-muted-foreground">
              {t("Guardado cifrado. Não é exibido de volta em nenhum momento.")}
            </span>
          </div>
          <Button type="submit" disabled={conectar.isPending} data-testid="btn-conectar">
            {conectar.isPending ? t("Validando com a Meta…") : t("Validar e conectar")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
