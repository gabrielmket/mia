/**
 * Descobre, com um token da Meta, QUAIS números esta conta enxerga — e por que
 * um número compartilhado pode não aparecer.
 *
 * ── O problema que este script existe para resolver ───────────────────────
 *
 * Conectar o canal oficial pede três valores opacos (`waba_id`,
 * `phone_number_id`, token) que só existem dentro do painel da Meta. Quando o
 * número é de OUTRA empresa — o caso normal: a academia tem a conta, a gente
 * opera — o operador precisa que a WABA do cliente tenha sido compartilhada
 * com o Business dele. E aí começa o modo de falha que motivou este arquivo:
 *
 *   "a WABA foi compartilhada comigo, mas o telefone não aparece"
 *
 * Compartilhar é um ato com QUATRO camadas, e o painel não distingue entre
 * elas. Falhar em qualquer uma produz exatamente o mesmo sintoma — uma lista
 * vazia, sem erro:
 *
 *   1. O ativo compartilhado é a CONTA DO WHATSAPP? Compartilhar a Página, o
 *      Portfólio ou a conta de anúncios não traz número nenhum junto.
 *   2. O convite de parceria foi ACEITO do lado de cá? Enquanto pendente, o
 *      ativo consta na tela de quem convidou e não existe para quem recebeu.
 *   3. O ativo foi atribuído ao USUÁRIO (ou ao usuário de sistema) que gerou o
 *      token? Compartilhar com o Business não dá acesso a ninguém dentro dele.
 *   4. O número foi mesmo ADICIONADO à WABA? Número que vive no aplicativo
 *      WhatsApp Business existe para o dono e não existe para a API.
 *
 * Este script pergunta as quatro coisas à própria Meta e diz em qual delas
 * parou. É a mesma pergunta que `lib/channels/meta/validate-credentials.ts`
 * faz na hora de conectar, só que subindo a árvore inteira em vez de validar
 * um id que alguém já teria de ter descoberto sozinho.
 *
 * ── Como rodar ────────────────────────────────────────────────────────────
 *
 *   META_TOKEN=... pnpm tsx scripts/meta-descobrir-numeros.ts
 *
 * O token entra por VARIÁVEL DE AMBIENTE e nunca por argumento: argumento fica
 * no histórico do shell e na lista de processos da máquina. Pelo mesmo motivo o
 * script não ecoa o token em lugar nenhum — nem no erro.
 *
 * A saída traz, por número: o `phone_number_id` e o `waba_id` prontos para
 * colar em Conexões › Oficial, mais o veredito de se aquele número SERVE.
 */

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v22.0"}`;

interface Negocio {
  id: string;
  name?: string;
}

interface Waba {
  id: string;
  name?: string;
  /** De onde veio: do Business do operador, ou compartilhada por um cliente. */
  origem: "própria" | "compartilhada pelo cliente";
}

interface Numero {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  /** CLOUD_API | ON_PREMISE | NOT_APPLICABLE — é o campo que decide tudo. */
  platform_type?: string;
}

class ErroDaMeta extends Error {
  constructor(
    readonly caminho: string,
    readonly detalhe: string,
    readonly codigo: number | null,
  ) {
    super(`${caminho}: ${detalhe}`);
  }
}

async function graph<T>(caminho: string, token: string): Promise<T[]> {
  const url = `${GRAPH}/${caminho}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    // Rede caída não é permissão faltando. Se este erro virasse "sem acesso", o
    // operador iria mexer no compartilhamento que já estava certo.
    throw new ErroDaMeta(caminho, `rede indisponível: ${err instanceof Error ? err.message : "erro"}`, null);
  }

  const corpo = (await res.json().catch(() => ({}))) as {
    data?: T[];
    error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
  };

  if (!res.ok || corpo.error) {
    const e = corpo.error;
    throw new ErroDaMeta(
      caminho,
      e?.error_user_msg ?? e?.message ?? `http_${res.status}`,
      typeof e?.code === "number" ? e.code : null,
    );
  }

  return corpo.data ?? [];
}

/** Uma linha por vez, para a saída ficar legível num terminal estreito. */
function linha(texto = ""): void {
  process.stdout.write(`${texto}\n`);
}

/**
 * O veredito por número — a parte que o painel da Meta não dá.
 *
 * `platform_type` é o campo decisivo e o menos conhecido: um número que vive no
 * APLICATIVO WhatsApp Business aparece na WABA e volta aqui como
 * `NOT_APPLICABLE`. Ele nunca vai conectar na Cloud API sem antes ser removido
 * do aplicativo — e essa é a causa de "o número existe, está tudo compartilhado
 * e mesmo assim não conecta".
 */
function veredito(n: Numero): { serve: boolean; nota: string } {
  const plataforma = (n.platform_type ?? "").toUpperCase();
  if (plataforma === "NOT_APPLICABLE" || plataforma === "") {
    return {
      serve: false,
      nota: "ainda no aplicativo WhatsApp Business — precisa sair de lá antes de virar Cloud API",
    };
  }
  if (plataforma === "ON_PREMISE") {
    return { serve: false, nota: "está na API local (on-premise), não na Cloud API" };
  }
  const verificacao = (n.code_verification_status ?? "").toUpperCase();
  if (verificacao && verificacao !== "VERIFIED") {
    return { serve: false, nota: `número ainda não verificado (${verificacao})` };
  }
  return { serve: true, nota: "pronto para conectar" };
}

async function main(): Promise<void> {
  const token = (process.env.META_TOKEN ?? "").trim();
  if (!token) {
    linha("Falta o token.");
    linha();
    linha("  META_TOKEN=... pnpm tsx scripts/meta-descobrir-numeros.ts");
    linha();
    linha("Por variável de ambiente, não por argumento: argumento fica no histórico do shell.");
    process.exitCode = 1;
    return;
  }

  linha("Perguntando à Meta o que este token enxerga…");
  linha();

  let negocios: Negocio[];
  try {
    negocios = await graph<Negocio>("me/businesses?fields=id,name&limit=100", token);
  } catch (err) {
    const e = err as ErroDaMeta;
    linha(`A Meta recusou logo na primeira pergunta: ${e.detalhe}`);
    linha();
    linha("Quase sempre é uma destas três:");
    linha("  · o token expirou (token temporário do painel dura 24 h);");
    linha("  · falta o escopo business_management no token;");
    linha("  · o token é de um app, não de um usuário ou usuário de sistema.");
    process.exitCode = 1;
    return;
  }

  if (negocios.length === 0) {
    linha("Este token não enxerga NENHUM portfólio empresarial.");
    linha();
    linha("Gere o token de dentro do Business que recebeu o compartilhamento —");
    linha("de preferência de um usuário de sistema, que não expira junto com a sessão.");
    process.exitCode = 1;
    return;
  }

  linha(`Portfólios empresariais visíveis: ${negocios.length}`);
  linha();

  let wabasNoTotal = 0;
  let numerosNoTotal = 0;
  let prontos = 0;

  for (const negocio of negocios) {
    linha(`── ${negocio.name ?? "(sem nome)"}  ·  id ${negocio.id}`);

    const wabas: Waba[] = [];
    for (const [campo, origem] of [
      ["owned_whatsapp_business_accounts", "própria"],
      ["client_whatsapp_business_accounts", "compartilhada pelo cliente"],
    ] as const) {
      try {
        const achadas = await graph<{ id: string; name?: string }>(
          `${negocio.id}/${campo}?fields=id,name&limit=100`,
          token,
        );
        for (const w of achadas) wabas.push({ id: w.id, name: w.name, origem });
      } catch (err) {
        const e = err as ErroDaMeta;
        // Não aborta: o outro campo pode responder, e é comum o token ter
        // acesso a um e não ao outro. Dizer qual falhou é a informação útil.
        linha(`   (não consegui ler ${campo}: ${e.detalhe})`);
      }
    }

    if (wabas.length === 0) {
      linha("   Nenhuma conta do WhatsApp neste portfólio.");
      linha("   Se o cliente disse que compartilhou: confira se o ativo é a CONTA DO WHATSAPP");
      linha("   (não a Página nem o portfólio), se o convite foi aceito deste lado, e se o");
      linha("   ativo foi atribuído ao usuário que gerou este token.");
      linha();
      continue;
    }

    wabasNoTotal += wabas.length;

    for (const waba of wabas) {
      linha(`   WABA ${waba.name ?? "(sem nome)"}  ·  ${waba.origem}`);
      linha(`   waba_id ......... ${waba.id}`);

      let numeros: Numero[];
      try {
        numeros = await graph<Numero>(
          `${waba.id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type&limit=100`,
          token,
        );
      } catch (err) {
        const e = err as ErroDaMeta;
        linha(`   Não consegui listar os números: ${e.detalhe}`);
        linha("   Costuma faltar o escopo whatsapp_business_management neste token.");
        linha();
        continue;
      }

      if (numeros.length === 0) {
        linha("   Esta conta não tem NENHUM número adicionado.");
        linha("   O compartilhamento está certo; o que falta é o número entrar na conta,");
        linha("   do lado do cliente, em WhatsApp Manager › Números de telefone.");
        linha();
        continue;
      }

      numerosNoTotal += numeros.length;

      for (const n of numeros) {
        const v = veredito(n);
        if (v.serve) prontos += 1;
        linha();
        linha(`   ${v.serve ? "✓" : "✗"} ${n.display_phone_number ?? "(número oculto)"}  ·  ${n.verified_name ?? "(sem nome verificado)"}`);
        linha(`     phone_number_id . ${n.id}`);
        linha(`     plataforma ...... ${n.platform_type ?? "(não informada)"}`);
        linha(`     verificação ..... ${n.code_verification_status ?? "(não informada)"}`);
        linha(`     qualidade ....... ${n.quality_rating ?? "(não informada)"}`);
        linha(`     → ${v.nota}`);
      }
      linha();
    }
  }

  linha("──");
  linha(
    `${wabasNoTotal} conta(s) do WhatsApp, ${numerosNoTotal} número(s), ${prontos} pronto(s) para conectar.`,
  );

  if (prontos > 0) {
    linha();
    linha("Para conectar: Conexões › Oficial, cole waba_id + phone_number_id + este mesmo token.");
    linha("Lembre que a instalação precisa de META_APP_SECRET e META_WEBHOOK_VERIFY_TOKEN");
    linha("no ambiente, ou o canal envia e nunca recebe.");
  }
}

void main();
