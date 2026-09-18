"use client";

/**
 * EMPRESAS — o cliente que é uma organização, não uma pessoa.
 *
 * A lista responde "quem são meus clientes"; a ficha responde as duas perguntas
 * que fizeram a entidade existir: quem fala com a gente lá dentro, e quanto já
 * negociamos com eles. Uma tela só de cadastro seria uma agenda de CNPJ.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import {
  useEmpresa,
  useEmpresas,
  useExcluirEmpresa,
  useSalvarEmpresa,
  type Empresa,
  type EmpresaEntrada,
} from "@/hooks/useEmpresas";

function formatarCnpj(v: string | null): string {
  if (!v) return "";
  const d = v.replace(/\D/g, "");
  if (d.length !== 14) return v;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function emReais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function FormularioDaEmpresa({
  empresa,
  aberto,
  aoFechar,
}: {
  empresa: Empresa | null;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const t = useT();
  const salvar = useSalvarEmpresa();
  const [dados, setDados] = useState<EmpresaEntrada>({});

  // O formulário nasce com o que já existe na ficha e sobrescreve só o que for
  // digitado: sem isso, editar o telefone apagaria o endereço, porque o PATCH
  // recebe o objeto inteiro.
  const valor = (campo: keyof EmpresaEntrada) =>
    (dados[campo] as string | undefined) ?? ((empresa?.[campo as keyof Empresa] as string) ?? "");

  const campo = (
    chave: keyof EmpresaEntrada,
    rotulo: string,
    extras?: { placeholder?: string },
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`empresa-${chave}`}>{rotulo}</Label>
      <Input
        id={`empresa-${chave}`}
        value={valor(chave)}
        placeholder={extras?.placeholder}
        onChange={(e) => setDados((d) => ({ ...d, [chave]: e.target.value }))}
      />
    </div>
  );

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) {
          setDados({});
          aoFechar();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{empresa ? t("Editar empresa") : t("Nova empresa")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {campo("nome", t("Nome"))}
          {campo("cnpj", t("CNPJ"), { placeholder: "00.000.000/0000-00" })}
          {campo("telefone", t("Telefone"))}
          {campo("email", t("E-mail"))}
          {campo("site", t("Site"))}
          {campo("endereco", t("Endereço"))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="empresa-observacoes">{t("Observações")}</Label>
          <Textarea
            id="empresa-observacoes"
            rows={3}
            value={valor("observacoes")}
            onChange={(e) => setDados((d) => ({ ...d, observacoes: e.target.value }))}
          />
        </div>
        <DialogFooter>
          <Button
            disabled={salvar.isPending || (!empresa && !(dados.nome ?? "").trim())}
            onClick={() =>
              salvar.mutate(
                { id: empresa?.id ?? null, dados: empresa ? dados : { ...dados } },
                {
                  onSuccess: () => {
                    setDados({});
                    aoFechar();
                  },
                },
              )
            }
          >
            {t("Salvar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FichaDaEmpresa({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const t = useT();
  const { data, isLoading } = useEmpresa(id);

  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{data?.nome ?? t("Carregando…")}</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <p className="text-sm text-text-muted">{t("Carregando…")}</p>
        ) : (
          <div className="space-y-5">
            <div className="text-sm text-text-muted">
              {[formatarCnpj(data.cnpj), data.telefone, data.email, data.site]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {data.endereco && <p className="text-sm">{data.endereco}</p>}
            {data.observacoes && <p className="whitespace-pre-wrap text-sm">{data.observacoes}</p>}

            <div>
              <h3 className="mb-2 font-medium">{t("Pessoas desta empresa")}</h3>
              {data.contatos.length === 0 ? (
                <p className="text-sm text-text-muted">
                  {t("Nenhum contato vinculado ainda. O vínculo se faz na ficha do contato.")}
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.contatos.map((c) => (
                    <li key={c.id}>
                      {c.display_name ?? c.name ?? t("sem nome")}
                      {c.phone_number ? ` · ${c.phone_number}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 font-medium">{t("Negócios")}</h3>
              {data.negocios.length === 0 ? (
                <p className="text-sm text-text-muted">{t("Nenhum negócio vinculado ainda.")}</p>
              ) : (
                <>
                  <ul className="space-y-1 text-sm">
                    {data.negocios.map((n) => (
                      <li key={n.id}>
                        {n.title}
                        {n.value_cents ? ` · ${emReais(n.value_cents)}` : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm font-medium">
                    {/* Só o que foi GANHO. Somar aberto e ganho num número só
                        produziria um valor que não responde nenhuma das duas
                        perguntas — e pareceria certo. */}
                    {t("Total ganho")}: {emReais(data.total_ganho_cents)}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function EmpresasClient() {
  const t = useT();
  const [busca, setBusca] = useState("");
  const { data, isLoading } = useEmpresas(busca);
  const excluir = useExcluirEmpresa();
  const [editando, setEditando] = useState<Empresa | null>(null);
  const [criando, setCriando] = useState(false);
  const [fichaAberta, setFichaAberta] = useState<string | null>(null);

  const empresas = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("Empresas")}</h1>
          <p className="text-sm text-text-muted">
            {t("Os clientes que são empresa. Cada uma reúne as pessoas e os negócios dela.")}
          </p>
        </div>
        <Button onClick={() => setCriando(true)}>{t("Nova empresa")}</Button>
      </div>

      <Input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder={t("Buscar por nome ou CNPJ")}
        className="sm:max-w-sm"
      />

      {isLoading ? (
        <p className="text-sm text-text-muted">{t("Carregando…")}</p>
      ) : empresas.length === 0 ? (
        <p className="text-sm text-text-muted">
          {busca
            ? t("Nenhuma empresa encontrada com esse termo.")
            : t("Nenhuma empresa cadastrada ainda.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Nome")}</TableHead>
                <TableHead>{t("CNPJ")}</TableHead>
                <TableHead>{t("Telefone")}</TableHead>
                <TableHead className="text-right">{t("Ações")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {empresas.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium underline-offset-2 hover:underline"
                      onClick={() => setFichaAberta(e.id)}
                    >
                      {e.nome}
                    </button>
                  </TableCell>
                  <TableCell>{formatarCnpj(e.cnpj)}</TableCell>
                  <TableCell>{e.telefone}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button variant="secondary" onClick={() => setEditando(e)}>
                      {t("Editar")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={excluir.isPending}
                      onClick={() => excluir.mutate(e.id)}
                    >
                      {t("Excluir")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(criando || editando) && (
        <FormularioDaEmpresa
          empresa={editando}
          aberto
          aoFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
        />
      )}
      {fichaAberta && <FichaDaEmpresa id={fichaAberta} aoFechar={() => setFichaAberta(null)} />}
    </div>
  );
}
