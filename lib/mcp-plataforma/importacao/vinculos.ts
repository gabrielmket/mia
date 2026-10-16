/**
 * VINCULAR PESSOAS A EMPRESAS — os vínculos de uma base que vem de outro CRM (.79).
 *
 * ── Por que esta ferramenta existe ────────────────────────────────────────
 *
 * Desde a empresa única (docs/fork/empresa-unica.md, protótipo aprovado em
 * 15/10/2026) uma pessoa pode estar em VÁRIAS empresas, com papel e cargo em
 * cada uma, e vários números da mesma pessoa são uma pessoa só. A importação de
 * contatos liga cada contato a UMA empresa (a da linha); CRM de origem que
 * exporta os vínculos à parte (a planilha "contatos × empresas", o contador que
 * atende três clientes, o telefone da recepção e o celular do dono) precisa de
 * uma porta própria, e a regra da casa é que peça nova do sistema ganha
 * ferramenta no MCP de plataforma na mesma versão.
 *
 * ── O que cada item faz ───────────────────────────────────────────────────
 *
 * Acha o contato (id, telefone ou e-mail) e:
 *
 *  - com `empresa_*`: liga a pessoa à empresa (id, CNPJ ou nome; a empresa
 *    precisa EXISTIR: importe com `plataforma_importar_empresas` antes), com
 *    papel, cargo, setor, principal e se é a empresa do cartão. A porta é a
 *    mesma da tela, `fn_mia_vincular_pessoa` (9034): um principal por empresa,
 *    papel na lista fechada;
 *  - com `outro_numero_*`: diz que outro contato é a MESMA pessoa
 *    (`fn_mia_juntar_numeros`): os vínculos dos dois se somam, e cada número
 *    segue com a sua conversa.
 *
 * `completar` (padrão) só preenche o que o vínculo não tem; `atualizar` troca.
 * Nos dois, nada é apagado e nenhuma mensagem sai.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { normalizePhoneBR } from "@/lib/webhooks/inbound";

import {
  Coletor,
  ehObjeto,
  listaDeItens,
  modoQuandoJaExiste,
  organizacaoDaImportacao,
  origemDaImportacao,
  pareceUuid,
  registrarImportacao,
  requestIdDe,
  texto,
} from "./base";
import { redigirLote } from "./auditoria";
import { acharContatoPorEmail, acharContatoPorTelefone, type ContatoNaBase } from "./contatos";
import { EmpresasDaBase } from "./empresas";
import { OPERACAO_IMPORTAR_BASE } from "./operacoes";
import type { ContextoDaFerramenta, FerramentaDeImportacao, ResultadoDoLote } from "./tipos";

export const TETO_DE_VINCULOS = 200;

const PAPEIS = ["decisor", "financeiro", "usuario", "influenciador", "outro"] as const;

export const EXEMPLO_DE_VINCULO = {
  contato_telefone: "(31) 90000-0700",
  empresa_cnpj: "12.345.678/0001-90",
  papel: "financeiro",
  cargo: "Contador externo",
  principal: false,
  empresa_do_cartao: false,
};

export const EXEMPLO_DE_MESMA_PESSOA = {
  contato_telefone: "(31) 90000-0101",
  outro_numero_telefone: "(31) 90000-0109",
};

interface VinculoLido {
  contato: { id: string | null; telefone: string | null; email: string | null };
  empresa: { id: string | null; cnpj: string | null; nome: string | null } | null;
  outro: { id: string | null; telefone: string | null; email: string | null } | null;
  papel: string | null;
  cargo: string | null;
  setor: string | null;
  principal: boolean | null;
  noCartao: boolean;
}

function booleano(v: unknown): boolean | null {
  if (v === true || v === "true" || v === "sim" || v === 1) return true;
  if (v === false || v === "false" || v === "nao" || v === "não" || v === 0) return false;
  return null;
}

function lerVinculo(
  item: unknown,
): { ok: true; vinculo: VinculoLido } | { ok: false; campo: string; esperado: string; exemplo?: string } {
  if (!ehObjeto(item)) {
    return { ok: false, campo: "(item)", esperado: "cada item é um objeto.", exemplo: JSON.stringify(EXEMPLO_DE_VINCULO) };
  }
  const telefoneBruto = texto(item.contato_telefone, 40);
  const contato = {
    id: pareceUuid(item.contato_id) ? (item.contato_id as string).trim() : null,
    telefone: telefoneBruto ? normalizePhoneBR(telefoneBruto) : null,
    email: texto(item.contato_email, 200)?.toLowerCase() ?? null,
  };
  if (!contato.id && !contato.telefone && !contato.email) {
    return {
      ok: false,
      campo: telefoneBruto ? "contato_telefone" : "contato",
      esperado: telefoneBruto
        ? "o telefone do contato não é um número válido (DDD + número)."
        : "diga quem é o contato: `contato_id`, `contato_telefone` ou `contato_email`.",
      exemplo: JSON.stringify(EXEMPLO_DE_VINCULO),
    };
  }

  const cnpj = (texto(item.empresa_cnpj, 40) ?? "").replace(/\D/g, "");
  const empresa =
    pareceUuid(item.empresa_id) || cnpj || texto(item.empresa_nome, 200)
      ? {
          id: pareceUuid(item.empresa_id) ? (item.empresa_id as string).trim() : null,
          cnpj: cnpj.length === 14 ? cnpj : null,
          nome: texto(item.empresa_nome, 200),
        }
      : null;

  const outroTelefone = texto(item.outro_numero_telefone, 40);
  const outro =
    pareceUuid(item.outro_numero_id) || outroTelefone || texto(item.outro_numero_email, 200)
      ? {
          id: pareceUuid(item.outro_numero_id) ? (item.outro_numero_id as string).trim() : null,
          telefone: outroTelefone ? normalizePhoneBR(outroTelefone) : null,
          email: texto(item.outro_numero_email, 200)?.toLowerCase() ?? null,
        }
      : null;

  if (!empresa && !outro) {
    return {
      ok: false,
      campo: "empresa",
      esperado:
        "diga a empresa (`empresa_id`, `empresa_cnpj` ou `empresa_nome`) e/ou o outro número da mesma pessoa " +
        "(`outro_numero_telefone`, `outro_numero_email` ou `outro_numero_id`).",
      exemplo: JSON.stringify(EXEMPLO_DE_VINCULO),
    };
  }

  let papel: string | null = null;
  const papelBruto = texto(item.papel, 40)?.toLowerCase() ?? null;
  if (papelBruto) {
    const semAcento = papelBruto.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (!(PAPEIS as readonly string[]).includes(semAcento)) {
      return { ok: false, campo: "papel", esperado: `o papel é um destes: ${PAPEIS.join(", ")}.`, exemplo: '"financeiro"' };
    }
    papel = semAcento;
  }

  return {
    ok: true,
    vinculo: {
      contato,
      empresa,
      outro,
      papel,
      cargo: texto(item.cargo, 120),
      setor: texto(item.setor, 120),
      principal: item.principal === undefined || item.principal === null ? null : booleano(item.principal),
      noCartao: booleano(item.empresa_do_cartao) === true,
    },
  };
}

async function acharContato(
  admin: SupabaseClient,
  orgId: string,
  quem: { id: string | null; telefone: string | null; email: string | null },
): Promise<ContatoNaBase | null> {
  if (quem.id) {
    const { data, error } = await admin
      .from("contacts")
      .select("id, is_anonymized, is_merged_into, person_id, empresa_id")
      .eq("organization_id", orgId)
      .eq("id", quem.id)
      .is("is_merged_into", null)
      .maybeSingle();
    if (error) throw new Error(`não consegui procurar o contato: ${error.message}`);
    return (data as unknown as ContatoNaBase | null) ?? null;
  }
  if (quem.telefone) {
    const achado = await acharContatoPorTelefone(admin, orgId, quem.telefone);
    if (achado) return achado;
  }
  return quem.email ? acharContatoPorEmail(admin, orgId, quem.email) : null;
}

export async function vincularPessoasAEmpresas(
  ctx: ContextoDaFerramenta,
  args: Record<string, unknown>,
): Promise<ResultadoDoLote> {
  const organizacao = await organizacaoDaImportacao(ctx.admin, args.organization_id);
  const itens = listaDeItens(args, "vinculos", TETO_DE_VINCULOS, EXEMPLO_DE_VINCULO);
  const modo = modoQuandoJaExiste(args.quando_ja_existe);
  const origem = origemDaImportacao(args.origem, false);
  const requestId = requestIdDe(ctx);
  const orgId = organizacao.id;

  const coletor = new Coletor();
  let empresas: EmpresasDaBase | null = null;

  for (let i = 0; i < itens.length; i += 1) {
    const posicao = i + 1;
    const lido = lerVinculo(itens[i]);
    if (!lido.ok) {
      coletor.recusar(posicao, lido.campo, lido.esperado, lido.exemplo);
      continue;
    }
    const v = lido.vinculo;
    const avisos: string[] = [];

    try {
      const contato = await acharContato(ctx.admin, orgId, v.contato);
      if (!contato) {
        coletor.recusar(
          posicao,
          "contato",
          "o contato não está na base. Importe-o com plataforma_importar_contatos e repita esta chamada.",
        );
        continue;
      }
      if (contato.is_anonymized) {
        coletor.recusar(posicao, "contato", "este contato foi ANONIMIZADO a pedido do titular (LGPD) e não recebe vínculo.");
        continue;
      }

      let mudou = false;

      // ── o outro número da mesma pessoa ──
      if (v.outro) {
        const outro = await acharContato(ctx.admin, orgId, v.outro);
        if (!outro) {
          avisos.push("O outro número não está na base: os dois não foram juntados. Importe o contato e repita.");
        } else if (outro.id === contato.id) {
          avisos.push("O outro número é o mesmo contato: nada a juntar.");
        } else if (outro.is_anonymized) {
          avisos.push("O outro número foi anonimizado (LGPD) e não entra numa pessoa.");
        } else {
          const { data: antes } = await ctx.admin
            .from("contacts")
            .select("person_id")
            .eq("organization_id", orgId)
            .in("id", [contato.id, outro.id]);
          const pessoas = new Set(((antes ?? []) as Array<{ person_id: string | null }>).map((p) => p.person_id));
          const jaEra = pessoas.size === 1 && !pessoas.has(null);
          if (!jaEra) {
            const { error } = await ctx.admin.rpc("fn_mia_juntar_numeros", {
              p_organization_id: orgId,
              p_contato_id: contato.id,
              p_outro_contato_id: outro.id,
            });
            if (error) {
              coletor.recusar(posicao, "outro_numero", `o banco recusou juntar os números: ${error.message}.`);
              continue;
            }
            mudou = true;
          }
        }
      }

      // ── a empresa ──
      if (v.empresa) {
        let empresaId: string | null = null;
        if (v.empresa.id) {
          const { data } = await ctx.admin
            .from("companies")
            .select("id")
            .eq("organization_id", orgId)
            .eq("id", v.empresa.id)
            .maybeSingle();
          empresaId = (data as { id: string } | null)?.id ?? null;
        } else {
          empresas ??= await EmpresasDaBase.carregar(ctx, orgId);
          empresaId = empresas.achar(v.empresa.nome, v.empresa.cnpj).empresa?.id ?? null;
        }
        if (!empresaId) {
          coletor.recusar(
            posicao,
            "empresa",
            "a empresa não está na base. Importe-a com plataforma_importar_empresas e repita esta chamada.",
          );
          continue;
        }

        // O que o vínculo já tem, para "completar" não trocar nada.
        const { data: pessoaAtual } = await ctx.admin
          .from("contacts")
          .select("person_id, empresa_id")
          .eq("organization_id", orgId)
          .eq("id", contato.id)
          .maybeSingle();
        const pessoaId = (pessoaAtual as { person_id: string | null } | null)?.person_id ?? null;
        const doCartao = (pessoaAtual as { empresa_id: string | null } | null)?.empresa_id ?? null;
        const { data: atual } = pessoaId
          ? await ctx.admin
              .from("company_people")
              .select("job_title, department, papel, is_primary")
              .eq("organization_id", orgId)
              .eq("company_id", empresaId)
              .eq("person_id", pessoaId)
              .maybeSingle()
          : { data: null };
        const vinculo = atual as { job_title: string | null; department: string | null; papel: string | null; is_primary: boolean } | null;

        const dados: Record<string, unknown> = {};
        const naoAplicados: string[] = [];
        const escalar = (chave: "cargo" | "setor" | "papel", veio: string | null, havia: string | null) => {
          if (!veio || veio === havia) return;
          if (!havia || modo === "atualizar") dados[chave] = veio;
          else naoAplicados.push(chave);
        };
        escalar("cargo", v.cargo, vinculo?.job_title ?? null);
        escalar("setor", v.setor, vinculo?.department ?? null);
        escalar("papel", v.papel, vinculo?.papel ?? null);
        if (v.principal !== null && v.principal !== (vinculo?.is_primary ?? false)) {
          // Ligar o principal é completar; desligar é trocar.
          if (v.principal || modo === "atualizar") dados.principal = v.principal;
          else naoAplicados.push("principal");
        }
        if (v.noCartao && doCartao !== empresaId) dados.no_cartao = true;

        if (naoAplicados.length > 0) {
          avisos.push(
            `O vínculo já tem outro valor em: ${naoAplicados.join(", ")}. Mantive o que estava. ` +
              'Para substituir, repita com quando_ja_existe: "atualizar".',
          );
        }
        if (!vinculo || Object.keys(dados).length > 0) {
          const { error } = await ctx.admin.rpc("fn_mia_vincular_pessoa", {
            p_organization_id: orgId,
            p_contato_id: contato.id,
            p_empresa_id: empresaId,
            p_dados: dados,
          });
          if (error) {
            coletor.recusar(posicao, "(gravação)", `o banco recusou o vínculo: ${error.message}.`);
            continue;
          }
          coletor.registrar(posicao, vinculo ? "atualizou" : "criou", { id: contato.id, avisos });
          continue;
        }
      }

      coletor.registrar(posicao, mudou ? "atualizou" : "ja_estava", { id: contato.id, avisos });
    } catch (err) {
      coletor.recusar(posicao, "(gravação)", err instanceof Error ? `${err.message}.` : "falha inesperada.");
    }
  }

  await registrarImportacao(ctx, {
    organizacao,
    ferramenta: "plataforma_vincular_pessoas_a_empresas",
    tipo: "vinculos",
    origem,
    coletor,
    requestId,
    extra: { quando_ja_existe: modo },
  });

  return coletor.resultado(organizacao);
}

export const FERRAMENTA_VINCULAR_PESSOAS_A_EMPRESAS: FerramentaDeImportacao = {
  name: "plataforma_vincular_pessoas_a_empresas",
  description:
    "Liga CONTATOS a EMPRESAS de um cliente, com papel, cargo, setor e o contato principal, e junta números que são da " +
    "MESMA pessoa. Para a base que vem de outro CRM com os vínculos à parte (a pessoa que está em duas empresas, o " +
    "contador que atende vários clientes, o telefone da recepção e o celular do dono). É um passo da migração depois " +
    "de empresas e contatos: equipe → funis → empresas → contatos → vínculos → negócios.\n\n" +
    `Teto: ${TETO_DE_VINCULOS} itens por chamada.\n\n` +
    "Cada item acha o contato pelo id, telefone ou e-mail e: (1) com a empresa (id, CNPJ ou nome; ela precisa existir), " +
    "liga a pessoa a ela: uma pessoa pode estar em várias empresas, e uma delas aparece no cartão " +
    "(`empresa_do_cartao: true` troca qual); o papel é um destes: " +
    `${PAPEIS.join(", ")}; há um principal por empresa (marcar outro tira o de antes); (2) com o outro número ` +
    "(telefone, e-mail ou id de OUTRO contato), diz que os dois são a mesma pessoa: as empresas dos dois se somam e cada " +
    "número segue com a sua conversa.\n\n" +
    "Pode ser repetida sem duplicar: a resposta diz, item a item, se criou o vínculo, atualizou, já estava ou recusou e " +
    "por quê. ANTES DE usar: as empresas e os contatos precisam estar na base (plataforma_importar_empresas e " +
    "plataforma_importar_contatos). O que NÃO faz: não cria contato nem empresa, não consulta a Receita, não apaga " +
    "vínculo e não envia nada.",
  inputSchema: {
    organization_id: z.string().describe("O id do cliente (de plataforma_listar_clientes)."),
    vinculos: z
      .array(z.unknown())
      .describe(
        `Até ${TETO_DE_VINCULOS} itens. Cada um: contato_id, contato_telefone ou contato_email (quem é); ` +
          "empresa_id, empresa_cnpj ou empresa_nome (a empresa), com papel, cargo, setor, principal (true|false) e " +
          "empresa_do_cartao (true|false); e/ou outro_numero_telefone, outro_numero_email ou outro_numero_id (outro " +
          `contato da mesma pessoa). Exemplos: ${JSON.stringify(EXEMPLO_DE_VINCULO)} e ${JSON.stringify(EXEMPLO_DE_MESMA_PESSOA)}`,
      ),
    origem: z
      .string()
      .optional()
      .describe('De qual sistema a base vem, em minúsculas e sem espaço (ex.: "rdstation"). Vai para o registro da importação.'),
    quando_ja_existe: z
      .string()
      .optional()
      .describe(
        '"completar" (padrão): só preenche o que o vínculo não tem. "atualizar": o que veio preenchido substitui o que havia. ' +
          "Nos dois, nada é apagado.",
      ),
  },
  operacao: OPERACAO_IMPORTAR_BASE,
  exemplo: {
    organization_id: "00000000-0000-4000-8000-000000000001",
    origem: "rdstation",
    vinculos: [EXEMPLO_DE_VINCULO, EXEMPLO_DE_MESMA_PESSOA],
  },
  handler: vincularPessoasAEmpresas,
  redigirParaAuditoria: redigirLote(["organization_id", "origem", "quando_ja_existe"], ["vinculos"]),
};
