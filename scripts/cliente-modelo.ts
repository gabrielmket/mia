/**
 * FORK MIA · CLIENTE MODELO — grava (ou renova) a "Empresa Modelo · Demonstração".
 *
 * Uso:
 *
 *   # conectado ao Postgres
 *   CLIENTE_MODELO_DATABASE_URL='postgresql://…' npx tsx scripts/cliente-modelo.ts            # só mostra o alvo
 *   CLIENTE_MODELO_DATABASE_URL='postgresql://…' npx tsx scripts/cliente-modelo.ts --aplicar  # grava
 *
 *   # sem conexão: gera o SQL (para o /pg/query do postgres-meta, ou psql)
 *   npx tsx scripts/cliente-modelo.ts --sql cliente-modelo.sql
 *
 * Variáveis:
 *
 *   CLIENTE_MODELO_DATABASE_URL       a connection string do Postgres (só no modo conectado).
 *                                     Nunca no código nem em arquivo versionado — só no
 *                                     ambiente de quem roda. Com SSL: `?sslmode=require`.
 *   CLIENTE_MODELO_EMAILS_DE_ACESSO   e-mails, separados por vírgula, de usuários que JÁ
 *                                     existem e ganham acesso de admin à demonstração. No SQL
 *                                     gerado, o usuário é achado pelo e-mail dentro do banco.
 *
 * O banco precisa ter a migration 9010 (a marca e a trava): sem ela a semente
 * para antes de gravar qualquer coisa — nos dois modos, a conferência é SQL.
 * Idempotente: rodar de novo não duplica, e renova as datas relativas (no SQL
 * gerado, as datas são as do momento em que ele foi gerado).
 *
 * Ver docs/fork/cliente-modelo.md.
 */
import { writeFileSync } from "node:fs";

import pg from "pg";

import { aplicarSemente, gerarSqlDaSemente } from "../lib/demonstracao/semente/aplicar";

function alvoLegivel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname} (usuário ${decodeURIComponent(u.username) || "?"})`;
  } catch {
    return "(connection string ilegível)";
  }
}

function emailsDeAcesso(): string[] {
  return (process.env.CLIENTE_MODELO_EMAILS_DE_ACESSO ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

async function gerarSql(arquivo: string | undefined): Promise<void> {
  if (!arquivo || arquivo.startsWith("--")) {
    console.error("Diga onde gravar: --sql <arquivo>.");
    process.exit(2);
  }
  const texto = await gerarSqlDaSemente({ emailsDeAcesso: emailsDeAcesso() });
  writeFileSync(arquivo, texto, "utf8");
  console.info(`SQL da empresa de demonstração gravado em ${arquivo} (${texto.length} caracteres).`);
  console.info("Uma transação só, idempotente; sem a migration 9010 ele aborta antes de gravar.");
}

async function main(): Promise<void> {
  const iSql = process.argv.indexOf("--sql");
  if (iSql >= 0) return gerarSql(process.argv[iSql + 1]);

  const url = process.env.CLIENTE_MODELO_DATABASE_URL?.trim();
  if (!url) {
    console.error(
      "Defina CLIENTE_MODELO_DATABASE_URL com a connection string do Postgres de destino, " +
        "ou use --sql <arquivo> para gerar o SQL sem conectar.",
    );
    process.exit(2);
  }
  const aplicar = process.argv.includes("--aplicar");

  console.info(`Alvo: ${alvoLegivel(url)}`);
  if (!aplicar) {
    console.info("Nada foi gravado. Rode de novo com --aplicar para gravar a empresa de demonstração.");
    return;
  }

  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    const resumo = await aplicarSemente(cliente, { emailsDeAcesso: emailsDeAcesso() });
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
