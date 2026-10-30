"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import {
  signupSchema,
  signupComConviteSchema,
  type SignupInput,
  type SignupComConviteInput,
} from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/app/actions/auth/signUp";
import { Eye, EyeSlash } from "@/lib/ui/icons";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import type { PlanoDoCadastro } from "@/lib/cobranca/cadastro";
// FORK MIA (.90): os planos em cartões e o que a empresa faz (docs/fork/jornada-de-assinatura.md).
import { CartoesDoPlano } from "@/components/planos-mia/CartoesDoPlano";
import type { CartaoDoPlano } from "@/lib/planos-mia/cadastro";
// FORK MIA (.96): na entrada paga, quem assina e os dados fiscais (docs/fork/pagamento-no-inicio.md).
import { CamposFiscais, FISCAIS_VAZIOS, type ValoresFiscais } from "@/components/pagamento-inicial/CamposFiscais";
import { conferirDadosFiscais, faltasDosDadosFiscais } from "@/lib/dados-fiscais/regras";
// FORK MIA (.98): o cupom do link ou digitado (docs/fork/cupons-e-parceiros.md).
import { CupomNoCadastro } from "@/components/cupons/CupomNoCadastro";
import type { CupomPublico } from "@/lib/cupons/publico";

/**
 * Convite em curso: a conta está sendo criada para ACEITAR um convite, não para
 * abrir uma empresa. Muda duas coisas na tela — some o campo "Nome da empresa"
 * (a empresa já existe; pedir seria mandar a pessoa batizar a organização de
 * outra gente) e o e-mail fica travado no do convite.
 */
export interface ConviteDoSignup {
  token: string;
  email: string;
}

export function SignupForm({
  convite,
  planos = [],
  planoInicial,
  cartoes = [],
  planoVeioDoLink = false,
  cupomInicial = null,
}: {
  convite?: ConviteDoSignup;
  planos?: readonly PlanoDoCadastro[];
  /** O plano padrão quando ele é oferecido — "sem mexer, vale o padrão" —, senão o primeiro. */
  planoInicial?: string;
  /** FORK MIA (.90): os mesmos planos em cartões, com limites e módulos. Vazio = o seletor do upstream. */
  cartoes?: readonly CartaoDoPlano[];
  /** FORK MIA (.90): o plano marcado veio do "?plano=" da página de preços. */
  planoVeioDoLink?: boolean;
  /** FORK MIA (.98): o cupom do link ("?cupom=") ou guardado no navegador. */
  cupomInicial?: CupomPublico | null;
}) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [contaExistente, setContaExistente] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  // FORK MIA (.96): os campos da entrada paga, fora do react-hook-form (a régua é a de
  // lib/dados-fiscais/regras.ts, a mesma da action).
  const [miaNome, setMiaNome] = useState("");
  const [miaWhatsapp, setMiaWhatsapp] = useState("");
  const [miaFiscais, setMiaFiscais] = useState<ValoresFiscais>(FISCAIS_VAZIOS);
  const [miaErrosFiscais, setMiaErrosFiscais] = useState<Record<string, string>>({});
  // FORK MIA (.98): o cupom em vigor na tela (válido no plano marcado, ou nulo).
  const [miaCupom, setMiaCupom] = useState<CupomPublico | null>(cupomInicial);
  const [miaCupomErro, setMiaCupomErro] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<SignupInput & { full_name: string; mia_o_que_faz?: string }>({
    // O formulário tem UM tipo e DOIS contratos, e agora os dois contratos têm
    // um campo que o outro não tem: `org_name` só no caminho de quem abre
    // empresa, `full_name` só no de quem foi convidado. O resolver troca; o
    // tipo do form é a união larga dos dois, e cada campo só é renderizado —
    // e só é enviado — no modo a que pertence. O `as unknown as` existe porque
    // os dois contratos deixaram de se sobrepor o bastante para o TypeScript
    // aceitar a conversão direta.
    resolver: (convite
      ? zodResolver(signupComConviteSchema)
      : zodResolver(signupSchema)) as unknown as Resolver<SignupInput & { full_name: string }>,
    defaultValues: {
      full_name: "",
      org_name: "",
      cobranca_plan_id: planoInicial,
      mia_o_que_faz: "",
      email: convite?.email ?? "",
      password: "",
      password_confirm: "",
    },
  });
  const password = useWatch({ control, name: "password" });
  // FORK MIA (.96): o plano marcado é de entrada paga (0 dia de teste)?
  const planoMarcado = useWatch({ control, name: "cobranca_plan_id" });
  // FORK MIA (.98): o cupom de dias grátis, válido no plano, faz o cadastro ser o do teste.
  const cupomDeDiasNoPlano = miaCupom?.valido === true && miaCupom.beneficio === "dias" && typeof planoMarcado === "string" && miaCupom.planos.includes(planoMarcado);
  const entradaPaga =
    !convite &&
    !cupomDeDiasNoPlano &&
    (cartoes.find((c) => c.id === planoMarcado)?.trial_dias ?? planos.find((p) => p.id === planoMarcado)?.trial_dias) === 0;

  const onSubmit = (values: SignupInput & { full_name: string }) => {
    setServerError(null);
    startTransition(async () => {
      // No modo convite o e-mail do formulário é readonly, e readonly no
      // cliente não vale nada: quem confere de novo é o servidor.
      // FORK MIA (.96): na entrada paga, quem assina e os dados fiscais vão junto,
      // conferidos aqui e de novo na action.
      if (entradaPaga) {
        const conferido = conferirDadosFiscais({ ...miaFiscais, telefone: miaWhatsapp }, { exigeTelefone: true });
        const faltas = conferido.ok ? [] : faltasDosDadosFiscais(conferido.campos);
        if (miaNome.trim().length < 2) faltas.unshift("seu nome");
        setMiaErrosFiscais(conferido.ok ? {} : (conferido.campos as Record<string, string>));
        if (faltas.length > 0) {
          setServerError(`${t("Falta preencher:")} ${faltas.map((f) => t(f)).join(", ")}.`);
          return;
        }
      }
      // FORK MIA (.98): o cupom vai junto só quando vale no plano marcado.
      const comCupom =
        miaCupom?.valido === true && typeof values.cobranca_plan_id === "string" && miaCupom.planos.includes(values.cobranca_plan_id) ? { mia_cupom: miaCupom.codigo } : {};
      const entrada: SignupInput | SignupComConviteInput = convite
        ? {
            full_name: values.full_name,
            email: convite.email,
            password: values.password,
            password_confirm: values.password_confirm,
          }
        : entradaPaga
          ? { ...values, ...comCupom, mia_nome: miaNome, mia_fiscal: { ...miaFiscais, telefone: miaWhatsapp } }
          : { ...values, ...comCupom };
      const res = await signUp(entrada, convite?.token);
      if (res.ok) {
        /**
         * ⚠️ O PROVEDOR JÁ DEIXOU A PESSOA ENTRAR — não existe e-mail para ela
         * esperar. Acontece quando "Confirm email" está desligado no provedor
         * de auth, que é uma escolha do operador da instalação e não um defeito
         * dele; o defeito é a tela abaixo, que manda "abra o e-mail e clique no
         * link" para quem já está autenticado. Sem este desvio a pessoa fica
         * parada nessa instrução para sempre: logada, sem organização, e sem
         * motivo nenhum para descobrir sozinha que a saída existe em
         * `/get-started`. Medido com um cliente real travado — achado de
         * @KIRAzinx566.
         *
         * O destino separa as duas naturezas de cadastro, com o dado que esta
         * tela já tem em mãos: quem veio de um convite vai ACEITAR o convite
         * (dar organização própria a essa pessoa é o erro que
         * `decidirConviteDoSignup` existe para evitar); quem se cadastrou por
         * conta própria vai à recuperação, que é o caminho auditado e com teto
         * de tentativas — e não uma segunda porta de provisionamento.
         */
        if (res.sessao_ativa) {
          router.replace(convite ? `/team/accept-invite/${convite.token}` : "/get-started");
          return;
        }
        setSentTo(values.email);
        return;
      }
      if (res.error === "rate_limited") {
        setServerError(t("Muitas tentativas. Aguarde alguns minutos."));
      } else if (res.error === "validation_error") {
        // As recusas do plano dizem o que fazer: "confira os campos" não diz.
        const recusaDoPlano = (res.details?.cobranca_plan_id as string[] | undefined)?.[0];
        // FORK MIA (.96): o que falta da entrada paga, pela régua do servidor.
        const faltasDoServidor = res.details?.mia_fiscal as string[] | undefined;
        // FORK MIA (.98): a recusa do cupom diz o motivo (vencido, esgotado, fora do plano).
        const recusaDoCupom = (res.details?.mia_cupom as string[] | undefined)?.[0];
        if (recusaDoCupom) {
          setMiaCupomErro(recusaDoCupom);
          setServerError(recusaDoCupom);
          return;
        }
        if (faltasDoServidor && faltasDoServidor.length > 0) {
          setServerError(`${t("Falta preencher:")} ${faltasDoServidor.map((f) => t(f)).join(", ")}.`);
          return;
        }
        setServerError(
          t(
            recusaDoPlano === "plano_indisponivel"
              ? "Esse plano não está mais disponível. Recarregue a página e escolha outro."
              : recusaDoPlano === "plano_obrigatorio"
                ? "Não foi possível carregar os planos agora. Recarregue a página e escolha um plano."
                : "Dados inválidos. Confira os campos.",
          ),
        );
      } else if (res.error === "conta_ja_existe" && convite) {
        // Ramo próprio porque o `else` mandava "Tente novamente" — e tentar de
        // novo nunca funciona quando a conta já existe. Em vez da mensagem,
        // a SAÍDA: entrar levando o convite pendurado, para cair no aceite e
        // não na tela inicial (que, para quem foi revogado, é a tela de acesso
        // revogado, com um botão Sair e mais nada).
        setContaExistente(true);
      } else if (res.error === "somente_convite") {
        // Ramo próprio porque o `else` diria "Tente novamente", e aqui tentar
        // de novo nunca vai funcionar — é política, não falha transitória.
        setServerError(
          t(
            "Esta instalação aceita cadastro apenas por convite. Se você foi convidado, use o link que chegou no seu e-mail.",
          ),
        );
      } else if (res.error === "email_indisponivel") {
        // Sem "Tente novamente": o e-mail de confirmação não sai enquanto a
        // instalação não tiver e-mail configurado, e só quem administra resolve.
        setServerError(
          t(
            convite
              ? "Não conseguimos enviar o e-mail de confirmação, porque o envio de e-mails desta instalação não está configurado. Tentar de novo não resolve: avise quem convidou você."
              : "Não conseguimos enviar o e-mail de confirmação, porque o envio de e-mails desta instalação não está configurado. Tentar de novo não resolve: avise quem administra o sistema.",
          ),
        );
      } else {
        setServerError(t("Não foi possível criar a conta. Tente novamente."));
      }
    });
  };

  if (contaExistente && convite) {
    const destino = `/login?next=${encodeURIComponent(`/team/accept-invite/${convite.token}`)}`;
    return (
      <div className="space-y-4 rounded-md border bg-muted/40 px-4 py-6 text-center" role="status">
        <p className="text-sm font-medium">{t("Você já tem uma conta com este e-mail")}</p>
        <p className="text-sm text-muted-foreground">
          {t("Entre com ela para aceitar o convite — não é preciso criar outra.")}
        </p>
        <Button asChild className="w-full">
          <Link href={destino}>{t("Entrar e aceitar o convite")}</Link>
        </Button>
      </div>
    );
  }

  if (sentTo) {
    return (
      <div className="space-y-2 rounded-md border bg-muted/40 px-4 py-6 text-center" role="status">
        <p className="text-sm font-medium">{t("Confirme seu e-mail")}</p>
        <p className="text-sm text-muted-foreground">
          {t("Enviamos um link de confirmação para")} <strong>{sentTo}</strong>.{" "}
          {t("Abra o e-mail e clique no link para ativar sua conta.")}
        </p>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {/*
        Só no modo CONVITE. Quem abre a própria empresa dá o nome no onboarding;
        quem é convidado pula o onboarding e ficava sem nome para sempre —
        aparecendo como um pedaço do identificador interno em toda tela que o
        nomeia (medido no diálogo de transferir conversa, em produção).
      */}
      {convite && (
        <div className="space-y-1.5">
          <Label htmlFor="full_name">{t("Seu nome")}</Label>
          <Input
            id="full_name"
            type="text"
            autoComplete="name"
            autoFocus
            aria-invalid={errors.full_name ? true : undefined}
            {...register("full_name")}
          />
          {errors.full_name && (
            <p className="text-xs text-destructive">{t(errors.full_name.message ?? "")}</p>
          )}
        </div>
      )}
      {/* FORK MIA (.96): na entrada paga, quem assina (o nome e o WhatsApp). */}
      {entradaPaga && (
        <div className="grid gap-3 sm:grid-cols-2" data-pagamento="quem-assina">
          <div className="space-y-1.5">
            <Label htmlFor="mia_nome">{t("Seu nome")}</Label>
            <Input id="mia_nome" type="text" autoComplete="name" maxLength={120} value={miaNome} onChange={(ev) => setMiaNome(ev.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mia_whatsapp">{t("WhatsApp")}</Label>
            <Input
              id="mia_whatsapp"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={32}
              value={miaWhatsapp}
              aria-invalid={miaErrosFiscais.telefone ? true : undefined}
              onChange={(ev) => setMiaWhatsapp(ev.target.value)}
            />
          </div>
        </div>
      )}
      {!convite && (
        <div className="space-y-1.5">
          <Label htmlFor="org_name">
            {t(entradaPaga ? (miaFiscais.tipo === "pf" ? "Nome do negócio" : "Nome fantasia") : "Nome da empresa")}
          </Label>
          <Input
            id="org_name"
            type="text"
            autoComplete="organization"
            autoFocus
            aria-invalid={errors.org_name ? true : undefined}
            {...register("org_name")}
          />
          {errors.org_name && (
            <p className="text-xs text-destructive">{t(errors.org_name.message ?? "")}</p>
          )}
        </div>
      )}
      {/* FORK MIA (.90): o que a empresa faz, opcional — vai na linha do pedido que a Time aprova. */}
      {!convite && (
        <div className="space-y-1.5">
          <Label htmlFor="mia_o_que_faz">{t("O que a sua empresa faz (opcional)")}</Label>
          <Input
            id="mia_o_que_faz"
            type="text"
            maxLength={200}
            placeholder={t("Ex.: clínica odontológica com avaliação e limpeza")}
            {...register("mia_o_que_faz")}
          />
        </div>
      )}
      {/* FORK MIA (.90): com os cartões, eles tomam o lugar do seletor (o mesmo campo). */}
      {!convite && cartoes.length > 0 && (
        <CartoesDoPlano cartoes={cartoes} registro={register("cobranca_plan_id")} veioDoLink={planoVeioDoLink} />
      )}
      {!convite && planos.length > 0 && cartoes.length === 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="cobranca_plan_id">{t("Plano")}</Label>
          <select id="cobranca_plan_id" className="h-10 w-full rounded-md border bg-background px-3 text-sm" {...register("cobranca_plan_id")}>
            {planos.map((plano) => (
              <option key={plano.id} value={plano.id}>
                {plano.nome} — {new Intl.NumberFormat(undefined, { style: "currency", currency: "BRL" }).format(plano.preco_cents / 100)} / {plano.intervalo === "ano" ? t("ano") : t("mês")}
                {plano.trial_dias > 0 ? ` · ${plano.trial_dias} ${t("dias de teste")}` : ` · ${t("sem período de teste")}`}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* FORK MIA (.98): o selo do cupom ou o campo "Tenho um cupom". */}
      {!convite && planos.length > 0 && (
        <CupomNoCadastro
          cupom={miaCupom}
          planoId={typeof planoMarcado === "string" ? planoMarcado : null}
          planos={planos}
          erroDoServidor={miaCupomErro}
          aoMudar={(c) => {
            setMiaCupom(c);
            setMiaCupomErro(null);
          }}
        />
      )}
      {/* FORK MIA (.96): na entrada paga, os dados da empresa para a cobrança e a nota fiscal. */}
      {entradaPaga && (
        <div className="rounded-md border p-3">
          <CamposFiscais
            valores={miaFiscais}
            aoMudar={setMiaFiscais}
            erros={miaErrosFiscais}
            prefixo="cadastro-fiscal"
            nomeFantasia={{ valor: getValues("org_name") ?? "", aoMudar: (v) => setValue("org_name", v) }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("Os dados fiscais ficam guardados na sua conta, visíveis só para quem administra a empresa.")}
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("Email")}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          // O convite vale para UM endereço. Deixar editável convidaria a
          // trocar e receber "email_divergente" depois de preencher tudo.
          readOnly={Boolean(convite)}
          aria-invalid={errors.email ? true : undefined}
          {...register("email")}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{t(errors.email.message ?? "")}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("Senha")}</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className="pr-12"
            aria-invalid={errors.password ? true : undefined}
            {...register("password")}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-hidden focus-visible:ring-inset"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {/* Nome em sr-only, não aria-label: getByLabel(/senha/i) casa aria-label e acharia o botão junto do campo. */}
            <span className="sr-only">{t(showPassword ? "Ocultar senha" : "Mostrar senha")}</span>
            {showPassword ? <EyeSlash size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
          </button>
        </div>
        {errors.password && (
          <p className="text-xs text-destructive">{t(errors.password.message ?? "")}</p>
        )}
        <PasswordStrength password={password} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password_confirm">{t("Confirmar senha")}</Label>
        <div className="relative">
          <Input
            id="password_confirm"
            type={showPasswordConfirm ? "text" : "password"}
            autoComplete="new-password"
            className="pr-12"
            aria-invalid={errors.password_confirm ? true : undefined}
            {...register("password_confirm")}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-hidden focus-visible:ring-inset"
            aria-pressed={showPasswordConfirm}
            onClick={() => setShowPasswordConfirm((visible) => !visible)}
          >
            <span className="sr-only">
              {t(
                showPasswordConfirm
                  ? "Ocultar confirmação da senha"
                  : "Mostrar confirmação da senha",
              )}
            </span>
            {showPasswordConfirm ? (
              <EyeSlash size={20} aria-hidden />
            ) : (
              <Eye size={20} aria-hidden />
            )}
          </button>
        </div>
        {errors.password_confirm && (
          <p className="text-xs text-destructive">{t(errors.password_confirm.message ?? "")}</p>
        )}
      </div>
      {serverError && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {serverError}
        </div>
      )}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? t("Criando conta...") : entradaPaga ? t("Criar conta e ir para o pagamento") : t("Criar conta")}
      </Button>
    </form>
  );
}
