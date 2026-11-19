---
impacto: capacidade_nova
secao: alterado
titulo: O consumo de IA de um cliente por mês do calendário e por agente, na aba Uso e no MCP
---

A leitura da aba Uso do cliente, no painel da plataforma, passa a aceitar um mês
do calendário (`mes=AAAA-MM`, no horário de Brasília) além dos dias corridos.
Com o mês, todos os números da aba são daquele mês. A resposta traz também o
consumo de IA de cada agente da empresa e uma linha "Sistema" com as chamadas
que não são de agente nenhum (o resumo depois da conversa, os classificadores, a
transcrição), além da quebra por finalidade. Cada linha tem as chamadas, os
tokens de entrada e de saída, quantos deles vieram do cache, e o custo em dólar
e em reais, convertido pela cotação de cada dia. Dia sem cotação fica fora do
total em reais, e a resposta diz quais dias foram.

O custo é a mesma soma que o teto do orçamento usa. O mês do teto segue sendo o
do banco (UTC), e por isso os dois números podem diferir nas últimas três horas
do mês.

O MCP de plataforma ganha `plataforma_ver_consumo_de_ia`, que lê o mesmo número
para um cliente e um mês. As telas com "Este mês" e "Mês passado" vêm depois.

A aba Uso também deixa de pedir ao banco uma coluna que a tabela de chamadas de
IA não tem. Os tokens dela passam a ser entrada mais saída.
