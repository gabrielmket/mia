"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useContact } from "@/hooks/contacts/useContact";
import { useContactList } from "@/hooks/contacts/useContactList";
import { useT } from "@/hooks/i18n/useT";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";

/**
 * O CONTATO DO NEGÓCIO JÁ CRIADO (fatia S3 da #852, upstream v1.126).
 *
 * FORK MIA (fusão v1.126): no upstream este seletor mora dentro do
 * `EditLeadDialog`, que lá ainda tem a sua cópia dos campos. No fork o diálogo
 * monta o `LeadFieldsForm` (os mesmos campos do dossiê), então o seletor veio
 * para um arquivo próprio, sem mudar uma linha, e o formulário o mostra quando
 * quem monta pede (`escolherContato`, só o diálogo do card). A escolha é entre
 * os contatos que JÁ EXISTEM: este fluxo não cria contato.
 */
export function ContatoDoNegocioEscolhido({
  contactId,
  onEscolher,
}: {
  contactId: string | null;
  onEscolher: (id: string | null) => void;
}) {
  const t = useT();
  const [escolhendo, setEscolhendo] = useState(false);
  // `useContact` segura a chamada sem id (`enabled: !!id`): negócio oco não faz
  // requisição nenhuma só para dizer que está oco.
  const { data } = useContact(contactId ?? "");
  const vinculado = data?.data;

  return (
    <div className="space-y-2" data-testid="contato-do-negocio-no-formulario">
      <p className="text-sm font-medium">{t("Contato do negócio")}</p>
      {escolhendo ? (
        <BuscaDeContato
          onEscolher={(id) => {
            onEscolher(id);
            setEscolhendo(false);
          }}
          onFechar={() => setEscolhendo(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-sm text-text-muted">
            {contactId
              ? vinculado
                ? nomeDoContato(vinculado)
                : t("Carregando…")
              : t("Este negócio não tem contato vinculado.")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setEscolhendo(true)}
          >
            {contactId ? t("Trocar contato") : t("Escolher contato")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A busca em si — montada só enquanto a escolha está aberta. */
function BuscaDeContato({
  onEscolher,
  onFechar,
}: {
  onEscolher: (id: string) => void;
  onFechar: () => void;
}) {
  const t = useT();
  const [busca, setBusca] = useState("");
  const termo = busca.trim();
  const { data, isLoading } = useContactList({ search: termo || undefined, limit: 5 });
  const contatos = data?.pages[0]?.data ?? [];

  return (
    <div
      className="space-y-2 rounded-md border border-border p-2"
      data-testid="busca-de-contato-do-negocio"
    >
      <Label htmlFor="busca-de-contato" className="text-xs">
        {t("Buscar contato")}
      </Label>
      <Input
        id="busca-de-contato"
        value={busca}
        placeholder={t("Nome ou telefone")}
        onChange={(e) => setBusca(e.target.value)}
      />
      {isLoading && <p className="text-[11px] text-text-muted">{t("Carregando…")}</p>}
      {!isLoading && contatos.length === 0 && (
        <p className="text-[11px] text-text-muted">{t("Nenhum contato encontrado.")}</p>
      )}
      <ul className="space-y-1">
        {contatos.map((contato) => (
          <li key={contato.id} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 truncate">{nomeDoContato(contato)}</span>
            {contato.phone_number && (
              <span className="shrink-0 text-text-muted">{contato.phone_number}</span>
            )}
            {/* `type="button"`: dentro de `<form>`, o padrão é submit — o mesmo
                defeito que o "+" do editor de etiquetas teve (teste da #3021). */}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-6 px-2 text-[11px]"
              onClick={() => onEscolher(contato.id)}
            >
              {t("Usar")}
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px] text-text-muted"
        onClick={onFechar}
      >
        {t("Cancelar")}
      </Button>
    </div>
  );
}
