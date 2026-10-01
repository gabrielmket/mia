"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateMicrosoftOAuth } from "@/app/actions/settings/updateMicrosoftOAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";

interface Props {
  readonly clientIdSalvo: string | null;
  /** SE existe segredo gravado, nunca QUAL (mesma disciplina de `/admin/google`). */
  readonly temSegredoSalvo: boolean;
  readonly segredoVenceEm: string | null;
  readonly tenantSalvo: string;
  readonly atualizadoEm: string | null;
  readonly temNoAmbiente: boolean;
  readonly enderecosDeRetorno: string[];
  readonly enderecoDasNotificacoes: string;
  readonly linkDoTi: string | null;
}

const DIA_MS = 86_400_000;

function diasAte(data: string | null): number | null {
  if (!data) return null;
  const alvo = Date.parse(`${data}T23:59:59Z`);
  return Number.isNaN(alvo) ? null : Math.ceil((alvo - Date.now()) / DIA_MS);
}

export function FormularioDaMicrosoft({
  clientIdSalvo,
  temSegredoSalvo,
  segredoVenceEm,
  tenantSalvo,
  atualizadoEm,
  temNoAmbiente,
  enderecosDeRetorno,
  enderecoDasNotificacoes,
  linkDoTi,
}: Props) {
  const t = useT();
  const router = useRouter();
  const [clientId, setClientId] = useState(clientIdSalvo ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [venceEm, setVenceEm] = useState(segredoVenceEm ?? "");
  const [soUmaEmpresa, setSoUmaEmpresa] = useState(tenantSalvo !== "common");
  const [tenant, setTenant] = useState(tenantSalvo === "common" ? "" : tenantSalvo);
  const [salvando, iniciar] = useTransition();

  const idValido = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(clientId.trim());
  const podeSalvar =
    idValido &&
    (temSegredoSalvo || clientSecret.trim().length >= 10) &&
    (!soUmaEmpresa || /^[A-Za-z0-9._-]{1,100}$/.test(tenant.trim()));
  const faltam = diasAte(segredoVenceEm);

  const copiar = (texto: string) => {
    void copyToClipboard(texto).then((ok) =>
      ok ? toast.success(t("Copiado.")) : toast.error(t("Não deu para copiar. Selecione o texto e copie.")),
    );
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Microsoft 365 desta instalação")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Com estas informações, quem atende conecta a agenda do Outlook (conta de trabalho ou pessoal) e o Teams passa a ser um local de atendimento. Valem para a instalação inteira; cada pessoa conecta a conta dela depois.",
          )}
        </p>
      </header>

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t("Endereço de retorno")}</Label>
          {enderecosDeRetorno.map((endereco) => (
            <div key={endereco} className="flex gap-2">
              <Input readOnly value={endereco} data-testid="microsoft-redirect" />
              <Button variant="outline" size="sm" type="button" onClick={() => copiar(endereco)}>
                {t("Copiar")}
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {t(
              "Cole exatamente isto em Autenticação › URIs de redirecionamento, plataforma Web, no registro do aplicativo. Registre o endereço de cada domínio pelo qual a equipe abre o sistema.",
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ms-client-id">{t("ID do aplicativo (cliente)")}</Label>
          <Input
            id="ms-client-id"
            data-testid="microsoft-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ms-client-secret">{t("Valor do segredo do cliente")}</Label>
          <Input
            id="ms-client-secret"
            data-testid="microsoft-client-secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={temSegredoSalvo ? t("(já cadastrado)") : "••••••••"}
          />
          <p className="text-xs text-muted-foreground">
            {temSegredoSalvo
              ? t("Já existe um segredo cadastrado. Deixe em branco para mantê-lo, ou digite um novo para substituir.")
              : t("Copie o Valor (não o ID do segredo). Ele é guardado cifrado e nunca volta a aparecer nesta tela.")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ms-vence">{t("O segredo vence em")}</Label>
          <Input id="ms-vence" type="date" value={venceEm} onChange={(e) => setVenceEm(e.target.value)} />
          {faltam !== null && faltam <= 30 ? (
            <p data-testid="microsoft-segredo-vencendo" className="text-xs font-medium text-warning">
              {faltam <= 0
                ? t("O segredo venceu. Crie um novo no registro do aplicativo e cole aqui: sem ele nenhuma agenda do Outlook renova.")
                : `${t("O segredo vence em")} ${faltam} ${t("dias. Crie um novo antes disso.")}`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("A Microsoft deixa o segredo durar no máximo 24 meses. Esta tela avisa 30 dias antes.")}
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("Quem pode conectar")}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="ms-tenant" checked={!soUmaEmpresa} onChange={() => setSoUmaEmpresa(false)} />
            {t("Qualquer empresa e contas pessoais")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="ms-tenant" checked={soUmaEmpresa} onChange={() => setSoUmaEmpresa(true)} />
            {t("Só uma empresa (ID do locatário)")}
          </label>
          {soUmaEmpresa ? (
            <Input
              aria-label={t("ID do locatário")}
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          ) : null}
        </fieldset>

        {linkDoTi ? (
          <div className="flex flex-col gap-1.5">
            <Label>{t("Link de aprovação para o TI de uma empresa")}</Label>
            <div className="flex gap-2">
              <Input readOnly value={linkDoTi} data-testid="microsoft-link-do-ti" />
              <Button variant="outline" size="sm" type="button" onClick={() => copiar(linkDoTi)}>
                {t("Copiar")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "Para a empresa que bloqueia aplicativos externos: o administrador de TI dela abre este link e aprova uma vez. Depois disso cada funcionário conecta sozinho.",
              )}
            </p>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {t("As notificações de mudança chegam em")}{" "}
          <code className="break-all font-mono text-[11px] text-text">{enderecoDasNotificacoes}</code>.{" "}
          {t("Não é preciso registrar este endereço; ele precisa ser HTTPS e público.")}
        </p>

        {temNoAmbiente ? (
          <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            {t(
              "Esta instalação já tem as credenciais no arquivo de configuração do servidor. O que você salvar aqui passa a valer no lugar delas.",
            )}
          </p>
        ) : null}

        <p className="rounded-md border border-warning/40 bg-warning-bg p-3 text-xs leading-4 text-text-muted">
          <strong className="font-semibold text-text">{t("Ao trocar o aplicativo:")}</strong>{" "}
          {t(
            "quem já conectou o Outlook vai precisar conectar de novo. Trocar só o segredo do MESMO aplicativo não derruba ninguém.",
          )}
        </p>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {atualizadoEm ? `${t("Última alteração em")} ${atualizadoEm}.` : t("Nunca configurado por aqui.")}
          </span>
          <Button
            data-testid="microsoft-salvar"
            disabled={!podeSalvar || salvando}
            onClick={() =>
              iniciar(async () => {
                const r = await updateMicrosoftOAuth({
                  client_id: clientId.trim(),
                  ...(clientSecret.trim() ? { client_secret: clientSecret.trim() } : {}),
                  segredo_vence_em: venceEm || null,
                  tenant: soUmaEmpresa ? tenant.trim() : "common",
                });
                if (!r.ok) {
                  toast.error(t(r.error));
                  return;
                }
                toast.success(t("Credenciais da Microsoft salvas."));
                setClientSecret("");
                router.refresh();
              })
            }
          >
            {salvando ? t("Salvando…") : t("Salvar")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
