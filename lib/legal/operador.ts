/**
 * Quem é o responsável legal por ESTA instalação.
 *
 * O DeskcommCRM é MIT e self-host: quem instala numa VPS opera o próprio
 * sistema, decide o que fazer com os dados dos clientes dele e responde por
 * eles. Os mantenedores do projeto não têm acesso ao banco de ninguém e não são
 * parte de nenhum contrato entre o operador e os clientes dele.
 *
 * Por isso os documentos legais não podem ser um texto fixo se apresentando
 * como "serviço prestado pelo DeskcommCRM": isso seria literalmente falso em
 * toda instalação de terceiro, e criaria obrigação para quem não pode cumpri-la.
 * O documento nomeia o OPERADOR — e, quando ele publicou a política dele, é a
 * dele que vale.
 *
 * ── DOIS MODOS, e o segundo faltava (migration 0267) ──────────────────────
 *
 * O desenho acima supõe UMA instalação = UM operador, e a organização da sessão
 * é ele. Isso vale no self-host e é falso no modelo GERENCIADO: uma instalação
 * da Time Company com Academia Beta, Academia Alfa e Vita Odonto dentro. Aberta
 * com a Academia Beta selecionada, `/legal/privacy` declarava que a Academia Beta
 * instalou o servidor e controla os dados de todos os tenants — e TROCAVA de
 * nome conforme quem estava logado. O mesmo documento, na mesma URL, nomeando
 * controladores diferentes para leitores diferentes.
 *
 * O interruptor é `platform_branding.operador_razao_social`:
 *
 *   nula        self-host — segue saindo da organização da sessão.
 *   preenchida  gerenciado — ESTE é o operador, para todo leitor, com sessão ou
 *               sem, e a organização da sessão não tem voz no documento.
 */
import { env } from "@/lib/env";
import { valorDaInstalacao } from "@/lib/instalacao/config";
import { branding } from "@/lib/branding";
import { loadAuthUser, orgAtivaSemPortao } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface Operador {
  /** Nome do sistema nesta instalação (respeita marca própria). */
  sistema: string;
  /** Nome comercial da organização, quando dá para saber quem está lendo. */
  nome: string | null;
  /** Razão social. */
  razaoSocial: string | null;
  cnpj: string | null;
  /** Contato do encarregado de dados (LGPD). */
  dpoEmail: string | null;
  /** Política própria do operador, já checada — nunca o valor cru do banco. */
  politicaPropria: string | null;
  /**
   * `false` quando a página foi aberta sem sessão. O texto continua íntegro:
   * só troca a razão social por "o operador desta instalação".
   */
  resolvido: boolean;
}

/**
 * A guarda de saída da URL de política do operador.
 *
 * O formulário valida esse campo com `z.string().url()`, e `url()` do zod
 * ACEITA `javascript:alert(1)` — é um esquema de URL válido. Como `/legal/*` é
 * rota pública, renderizar o valor cru num `<a href>` (ou passá-lo a
 * `redirect()`) deixaria um admin de tenant alcançar visitantes anônimos.
 *
 * A checagem mora aqui, na saída, e não no schema: o schema é compartilhado com
 * outros campos e já aceitou dados que estão gravados há tempo. Falhar fechado
 * aqui vale para o que já existe no banco, não só para o que for gravado depois.
 */
export function urlDePoliticaSegura(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  if (texto === "") return null;
  try {
    const url = new URL(texto);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return texto;
  } catch {
    // Não é URL absoluta. Um caminho relativo aqui apontaria para dentro do
    // próprio CRM, o que não é uma política de privacidade publicada.
    return null;
  }
}

/**
 * Virou `async` porque o contato do encarregado passou a vir do banco (migration
 * 0341), com o arquivo de instalação como piso. As três chamadas vivem dentro de
 * `resolverOperador`, que já era assíncrona — o alcance foi medido antes de
 * mudar a assinatura.
 */
const SEM_SESSAO = async (): Promise<Operador> => ({
  sistema: branding().name,
  nome: null,
  razaoSocial: null,
  cnpj: null,
  dpoEmail: (await valorDaInstalacao("LGPD_DPO_EMAIL")).valor?.trim() || null,
  politicaPropria: null,
  resolvido: false,
});

/**
 * O operador DECLARADO da instalação, ou `null` quando não há um (self-host).
 *
 * ⚠️ Lê com ADMIN CLIENT, e isso é deliberado — não é a exceção que o docstring
 * de `resolverOperador` proíbe. A proibição é sobre ler dado de TENANT numa rota
 * pública, porque ali o admin client resolveria "alguma" organização e
 * publicaria razão social, CNPJ e encarregado de um cliente para um visitante
 * anônimo. `platform_branding` é o oposto: é a identidade da PRÓPRIA
 * instalação, tem uma linha só, não pertence a tenant nenhum, e o que está nela
 * é exatamente o que uma política de privacidade EXISTE para divulgar. Não há
 * "alguma" linha a resolver, e não há de quem vazar.
 *
 * A tabela tem RLS ligada com ZERO policies, então o client de sessão leria
 * vazio — um visitante anônimo veria o documento sem operador nenhum, que é
 * justamente o leitor para quem ele mais importa.
 */
async function operadorDeclarado(): Promise<Operador | null> {
  const { data, error } = await createAdminClient()
    .from("platform_branding")
    .select(
      "operador_razao_social, operador_cnpj, operador_dpo_email, operador_politica_url",
    )
    .eq("id", 1)
    .maybeSingle();

  // Falha de leitura NÃO pode virar "não há operador declarado": isso derrubaria
  // silenciosamente a instalação gerenciada de volta ao modo self-host, e o
  // documento voltaria a nomear o cliente. Sem linha e com erro são coisas
  // diferentes — só a primeira significa self-host.
  if (error) throw new Error(`platform_branding ilegível: ${error.message}`);
  if (!data) return null;

  const linha = data as {
    operador_razao_social: string | null;
    operador_cnpj: string | null;
    operador_dpo_email: string | null;
    operador_politica_url: string | null;
  };

  const razaoSocial = linha.operador_razao_social?.trim() || null;
  if (!razaoSocial) return null;

  return {
    sistema: branding().name,
    // No modo gerenciado o nome comercial é o próprio sistema: a plataforma não
    // tem "nome fantasia" separado da marca que ela já pinta em toda tela.
    nome: null,
    razaoSocial,
    cnpj: linha.operador_cnpj?.trim() || null,
    // O piso passa pelo resolvedor, como nos outros dois leitores deste arquivo:
    // ler o ambiente direto aqui faria o campo do painel (migration 0341) não
    // mudar nada no documento do modo gerenciado.
    dpoEmail:
      linha.operador_dpo_email?.trim() ||
      (await valorDaInstalacao("LGPD_DPO_EMAIL")).valor?.trim() ||
      null,
    politicaPropria: urlDePoliticaSegura(linha.operador_politica_url),
    resolvido: true,
  };
}

/**
 * Lê os dados do operador com o client de SESSÃO, nunca com o service role: a
 * policy `orgs_select` já restringe a leitura às organizações do usuário. Numa
 * rota pública, um admin client resolveria "alguma" organização e publicaria
 * razão social, CNPJ e e-mail do encarregado de um tenant numa URL sem
 * autenticação — e resolveria a org de fonte não confiável, que é o
 * anti-pattern que a doutrina do projeto proíbe.
 *
 * Sem sessão, devolve o fallback. Não é caminho de erro: é o visitante que
 * colou o link, e ele tem direito a ler o documento inteiro.
 */
export async function resolverOperador(): Promise<Operador> {
  // ANTES da sessão, de propósito: no modo gerenciado o documento não pode
  // depender de quem está lendo. Ler a sessão primeiro e só então conferir o
  // declarado daria o mesmo resultado e deixaria a ordem sugerindo o contrário
  // para quem vier mexer.
  let declarado: Operador | null = null;
  try {
    declarado = await operadorDeclarado();
  } catch {
    // A leitura falhou. Cair para a organização da sessão nomearia o CLIENTE
    // como controlador — exatamente o defeito que a 0267 conserta — então o
    // caminho seguro é o documento genérico: íntegro, e sem acusar ninguém.
    return SEM_SESSAO();
  }
  if (declarado) return declarado;

  const user = await loadAuthUser();
  if (!user) return await SEM_SESSAO();

  const activeOrg = await orgAtivaSemPortao(user);
  if (!activeOrg) return await SEM_SESSAO();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("display_name, legal_name, cnpj, dpo_email, privacy_policy_url")
    .eq("id", activeOrg.orgId)
    .maybeSingle();

  // Falha de leitura não pode apagar o documento da tela: o texto do produto
  // vale para todo mundo, e o que se perde é só a personalização.
  if (error || !data) return { ...(await SEM_SESSAO()), sistema: branding().name };

  const org = data as {
    display_name: string | null;
    legal_name: string | null;
    cnpj: string | null;
    dpo_email: string | null;
    privacy_policy_url: string | null;
  };

  return {
    sistema: branding().name,
    nome: org.display_name?.trim() || null,
    razaoSocial: org.legal_name?.trim() || null,
    cnpj: org.cnpj?.trim() || null,
    // Mesmo fallback que o resto do produto já usa para o encarregado.
    dpoEmail:
      org.dpo_email?.trim() ||
      (await valorDaInstalacao("LGPD_DPO_EMAIL")).valor?.trim() ||
      null,
    politicaPropria: urlDePoliticaSegura(org.privacy_policy_url),
    resolvido: true,
  };
}

/** Como o documento se refere ao operador quando não dá para saber quem é. */
export function nomeDoOperador(op: Operador): string {
  return op.razaoSocial ?? op.nome ?? "o operador desta instalação";
}

/**
 * As colunas do responsável legal COMO ESTÃO no banco — para a tela de admin.
 *
 * Diferente de `resolverOperador`, que devolve o operador JÁ RESOLVIDO (com
 * fallbacks, com a URL checada, com o modo decidido). O formulário precisa do
 * valor cru: mostrar ao operador o piso da instalação (`LGPD_DPO_EMAIL`) como se fosse o que ele
 * digitou faria o campo mentir, e salvar depois gravaria no banco um valor que
 * ele nunca escolheu.
 *
 * `null` quando a linha não existe — instalação que nunca tocou na marca.
 */
export async function responsavelLegalGravado(): Promise<{
  operador_razao_social: string | null;
  operador_cnpj: string | null;
  operador_dpo_email: string | null;
  operador_politica_url: string | null;
} | null> {
  const { data, error } = await createAdminClient()
    .from("platform_branding")
    .select(
      "operador_razao_social, operador_cnpj, operador_dpo_email, operador_politica_url",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return null;
  return data as {
    operador_razao_social: string | null;
    operador_cnpj: string | null;
    operador_dpo_email: string | null;
    operador_politica_url: string | null;
  };
}
