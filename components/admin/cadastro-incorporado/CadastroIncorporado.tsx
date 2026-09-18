"use client";

/**
 * CADASTRO INCORPORADO — a porta em que o cliente entra com o Facebook dele.
 *
 * Duas coisas moram aqui porque são a mesma tarefa na cabeça de quem opera:
 * guardar o link que a Meta gera, e receber as contas que chegam por ele.
 *
 * ⚠️ A amarração é DELIBERADAMENTE manual. O aviso da Meta não diz de qual
 * cliente nosso ele é — o link é da instalação, não do tenant —, e dois
 * clientes que entrem na mesma tarde chegam indistinguíveis. Amarrar o número
 * errado ao tenant errado faz a conversa de um cliente sair pelo número de
 * outro: é o pior desfecho possível desta funcionalidade, e vale o clique a
 * mais.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  useAmarrarCadastro,
  useCadastroIncorporado,
  useSalvarLinkDoCadastro,
} from "@/hooks/useCadastroIncorporado";

export function CadastroIncorporado() {
  const t = useT();
  const { data, isLoading, error } = useCadastroIncorporado();
  const salvarLink = useSalvarLinkDoCadastro();
  const amarrar = useAmarrarCadastro();
  const [link, setLink] = useState<string | null>(null);
  const [destino, setDestino] = useState<Record<string, string>>({});

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar o cadastro incorporado agora.")}</p>;
  }

  const pendentes = data.chegadas.filter((c) => !c.organization_id);
  const amarradas = data.chegadas.filter((c) => c.organization_id);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("Link do cadastro incorporado")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-text-muted">
            {t(
              "Gere o link no painel da Meta (Torne-se um parceiro › Cadastro incorporado hospedado) e cole aqui. Sem link, a tela do cliente mostra só a conexão manual.",
            )}
          </p>
          <div className="space-y-1">
            <Label htmlFor="link-do-cadastro">{t("Link")}</Label>
            <Input
              id="link-do-cadastro"
              value={link ?? data.embedded_signup_url ?? ""}
              placeholder="https://business.facebook.com/…"
              onChange={(e) => setLink(e.target.value)}
            />
          </div>
          <Button
            disabled={salvarLink.isPending}
            onClick={() =>
              salvarLink.mutate(
                { embedded_signup_url: (link ?? data.embedded_signup_url ?? "").trim() || null },
                { onSuccess: () => setLink(null) },
              )
            }
          >
            {t("Salvar")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Contas que chegaram")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pendentes.length === 0 ? (
            <p className="text-sm text-text-muted">
              {t("Nenhuma conta esperando. Quando um cliente terminar o cadastro, ela aparece aqui.")}
            </p>
          ) : (
            pendentes.map((c) => (
              <div key={c.id} className="space-y-2 rounded-md border border-border p-4">
                <p className="font-medium">{c.business_name ?? c.waba_id}</p>
                <p className="text-sm text-text-muted">
                  {[c.phone_number, `WABA ${c.waba_id}`].filter(Boolean).join(" · ")}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={destino[c.waba_id] ?? ""}
                    onValueChange={(v) => setDestino((d) => ({ ...d, [c.waba_id]: v }))}
                  >
                    <SelectTrigger className="sm:w-80" aria-label={t("De qual cliente é esta conta")}>
                      <SelectValue placeholder={t("De qual cliente é esta conta?")} />
                    </SelectTrigger>
                    <SelectContent>
                      {data.empresas.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={!destino[c.waba_id] || !c.phone_number_id || amarrar.isPending}
                    onClick={() =>
                      amarrar.mutate({
                        waba_id: c.waba_id,
                        organization_id: destino[c.waba_id]!,
                        phone_number_id: c.phone_number_id!,
                      })
                    }
                  >
                    {t("Amarrar")}
                  </Button>
                </div>
                {!c.phone_number_id && (
                  <p className="text-sm text-error-fg">
                    {/* Sem o id do número não há canal a criar. É a Meta que às
                        vezes avisa a conta antes do número — a linha fica, e a
                        próxima notificação a completa. */}
                    {t("A Meta ainda não mandou o número desta conta. Ela avisa de novo quando mandar.")}
                  </p>
                )}
              </div>
            ))
          )}

          {amarradas.length > 0 && (
            <div className="pt-2">
              <h3 className="mb-2 text-sm font-medium">{t("Já amarradas")}</h3>
              <ul className="space-y-1 text-sm text-text-muted">
                {amarradas.map((c) => (
                  <li key={c.id}>
                    {(c.business_name ?? c.waba_id)} → {c.organizacao}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
