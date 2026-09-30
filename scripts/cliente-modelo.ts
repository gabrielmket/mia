/**
 * FORK MIA · CLIENTE MODELO — grava (ou renova) a "Empresa Modelo · Demonstração".
 *
 * Uso:
 *
 *   CLIENTE_MODELO_DATABASE_URL='postgresql://…' npx tsx scripts/cliente-modelo.ts            # só mostra o alvo
 *   CLIENTE_MODELO_DATABASE_URL='postgresql://…' npx tsx scripts/cliente-modelo.ts --aplicar  # grava
 *
 * Variáveis:
 *
 *   CLIENTE_MODELO_DATABASE_URL       a connection string do Postgres (obrigatória). Nunca no
 *                                     código nem em arquivo versionado — só no ambiente de
 *                                     quem roda. Com SSL: acrescente `?sslmode=require`.
 *   CLIENTE_MODELO_EMAILS_DE_ACESSO   e-mails, separados por vírgula, de usuários que JÁ
 *                                     existem e ganham acesso de admin à demonstração.
 *
 * O banco precisa ter a migration 9010 (a marca e a trava): sem ela a semente
 * para antes de gravar qualquer coisa. Idempotente — rodar de novo não duplica,
 * e renova as datas relativas (agenda, follow-ups em andamento).
 *
 * Ver docs/fork/cliente-modelo.md.
 */
import pg from "pg";

import { aplicarSemente } from "../lib/demonstracao/semente/aplicar";

function alvoLegivel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname} (usuário ${decodeURIComponent(u.username) || "?"})`;
  } catch {
    return "(connection string ilegível)";
  }
}

async function main(): Promise<void> {
  const url = process.env.CLIENTE_MODELO_DATABASE_URL?.trim();
  if (!url) {
    console.error("Defina CLIENTE_MODELO_DATABASE_URL com a connection string do Postgres de destino.");
    process.exit(2);
  }
  const aplicar = process.argv.includes("--aplicar");
  const emails = (process.env.CLIENTE_MODELO_EMAILS_DE_ACESSO ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  console.info(`Alvo: ${alvoLegivel(url)}`);
  if (!aplicar) {
    console.info("Nada foi gravado. Rode de novo com --aplicar para gravar a empresa de demonstração.");
    return;
  }

  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    const { rows } = await cliente.query<{ existe: boolean }>(
      `select exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'organizations' and column_name = 'demonstracao'
       ) as existe`,
    );
    if (!rows[0]?.existe) {
      console.error("Este banco não tem a migration 9010 (organizations.demonstracao). Nada foi gravado.");
      process.exit(3);
    }

    const resumo = await aplicarSemente(cliente, { emailsDeAcesso: emails });
    console.info(`Empresa de demonstração: ${resumo.organizacaoId}`);
    for (const [tabela, n] of Object.entries(resumo.contagens)) console.info(`  ${tabela.padEnd(28)} ${n}`);
    for (const aviso of resumo.avisos) console.warn(`  aviso: ${aviso}`);
  } finally {
    await cliente.end();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
