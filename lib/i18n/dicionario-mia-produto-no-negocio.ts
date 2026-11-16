/**
 * FORK MIA (.109) · as frases do produto no negócio (docs/fork/produto-no-negocio.md),
 * em espanhol: o bloco de itens, o valor que soma, a janela de ganho, a linha do
 * cartão, as opções do funil, os dois quadros do relatório e as recusas da rota.
 *
 * Moram num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha,
 * para a sincronização com o upstream não conflitar a cada frase nova
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português. `{produto}` e
 * `{produtos}` são a palavra do funil (dado do cliente, não se traduz).
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DO_PRODUTO_NO_NEGOCIO: Traducoes = {
  // a palavra do sistema
  "produto ou serviço": { es: "producto o servicio" },
  "produtos e serviços": { es: "productos y servicios" },
  "Produto ou serviço": { es: "Producto o servicio" },
  "Produto ou serviço (padrão)": { es: "Producto o servicio (predeterminado)" },

  // o bloco de itens
  "Do catálogo de Produtos, com o preço de lá. Quantidade e desconto ficam neste negócio.": {
    es: "Del catálogo de Productos, con el precio de allí. La cantidad y el descuento quedan en este negocio.",
  },
  "Buscar {produto} no catálogo": { es: "Buscar {produto} en el catálogo" },
  "Buscar {produto} no catálogo pelo nome ou código": { es: "Buscar {produto} en el catálogo por nombre o código" },
  "{produtos} do catálogo": { es: "{produtos} del catálogo" },
  "Nenhum {produto} com esse nome no catálogo. Quem é gestor cadastra em Produtos.": {
    es: "Ningún {produto} con ese nombre en el catálogo. Quien es gestor lo registra en Productos.",
  },
  "já no negócio, soma 1 na quantidade": { es: "ya en el negocio, suma 1 a la cantidad" },
  "Nenhum {produto} ainda. Busque acima pelo nome ou pelo código.": {
    es: "Ningún {produto} todavía. Busque arriba por el nombre o el código.",
  },
  "da proposta {numero}": { es: "de la propuesta {numero}" },
  "desconto": { es: "descuento" },
  "{preco} no catálogo": { es: "{preco} en el catálogo" },
  "muda pela": { es: "cambia por la" },
  "proposta {numero}": { es: "propuesta {numero}" },
  "Diminuir a quantidade de {nome}": { es: "Disminuir la cantidad de {nome}" },
  "Quantidade de {nome}": { es: "Cantidad de {nome}" },
  "Aumentar a quantidade de {nome}": { es: "Aumentar la cantidad de {nome}" },
  "Quantidade de 1 a 99.": { es: "Cantidad de 1 a 99." },
  "Desconto inválido. Use só números, como 150 ou 150,00.": {
    es: "Descuento inválido. Use solo números, como 150 o 150,00.",
  },
  "O desconto não pode passar do valor do {produto}.": { es: "El descuento no puede superar el valor del {produto}." },
  "O desconto não pode passar do valor do item.": { es: "El descuento no puede superar el valor del ítem." },
  "Tirar {nome}": { es: "Quitar {nome}" },
  "{nome} saiu.": { es: "{nome} salió." },
  "{nome} entrou. Soma {soma}.": { es: "{nome} entró. Suma {soma}." },
  "{nome}: quantidade {quantidade}. Soma {soma}.": { es: "{nome}: cantidad {quantidade}. Suma {soma}." },
  "Soma dos {produtos}": { es: "Suma de los {produtos}" },

  // o valor que soma
  "A soma aparece quando você escolher um {produto}.": { es: "La suma aparece cuando elija un {produto}." },
  "Soma dos {produtos}.": { es: "Suma de los {produtos}." },
  "Digitar o valor à mão": { es: "Escribir el valor a mano" },
  "Negócio de antes dos {produtos}:": { es: "Negocio de antes de los {produtos}:" },
  "o valor foi digitado à mão e continua valendo até você pedir para somar.": {
    es: "el valor se escribió a mano y sigue valiendo hasta que pida sumar.",
  },
  "Digitado à mão:": { es: "Escrito a mano:" },
  "este valor não soma mais os {produtos}. Mudar um {produto} não muda este valor.": {
    es: "este valor ya no suma los {produtos}. Cambiar un {produto} no cambia este valor.",
  },
  "Soma dos {produtos} hoje:": { es: "Suma de los {produtos} hoy:" },
  "Usar a soma": { es: "Usar la suma" },
  "Voltar a somar": { es: "Volver a sumar" },
  "Corrija o valor antes de salvar.": { es: "Corrija el valor antes de guardar." },

  // o valor recorrente no funil que não o usa
  "Valor no campo errado?": { es: "¿Valor en el campo equivocado?" },
  "Este negócio tem {valor} em Valor recorrente (mensal), um campo que este funil não usa. Parece o valor do {produto}, digitado no lugar errado.":
    {
      es: "Este negocio tiene {valor} en Valor recurrente (mensual), un campo que este embudo no usa. Parece el valor del {produto}, escrito en el lugar equivocado.",
    },
  "Apagar o valor recorrente": { es: "Borrar el valor recurrente" },
  "Escolha o {produto} acima e o valor certo vem da soma.": { es: "Elija el {produto} arriba y el valor correcto sale de la suma." },
  "O valor recorrente sai quando você salvar.": { es: "El valor recurrente se quita cuando guarde." },
  "valor no recorrente": { es: "valor en el recurrente" },
  "Este negócio tem valor no campo Valor recorrente, que este funil não usa": {
    es: "Este negocio tiene valor en el campo Valor recurrente, que este embudo no usa",
  },

  // a linha do cartão
  "Sem {produto}": { es: "Sin {produto}" },
  "Nenhum {produto} escolhido": { es: "Ningún {produto} elegido" },

  // a janela de ganho
  "vai para": { es: "pasa a" },
  "Confira o que foi fechado: dá para mudar quantidade e desconto, tirar ou somar {produtos}.": {
    es: "Revise lo que se cerró: puede cambiar cantidad y descuento, quitar o sumar {produtos}.",
  },
  "Não consegui ler os {produtos} deste negócio agora. Dá para fechar sem eles.": {
    es: "No pude leer los {produtos} de este negocio ahora. Puede cerrar sin ellos.",
  },
  "Este negócio ainda não tem {produto}.": { es: "Este negocio todavía no tiene {produto}." },
  "Escolha o que foi fechado para continuar.": { es: "Elija lo que se cerró para continuar." },
  'Este negócio não tem {produto}. Neste funil escolher é opcional, mas sem ele o fechamento entra como "Sem {produto}" no relatório.':
    {
      es: 'Este negocio no tiene {produto}. En este embudo elegir es opcional, pero sin él el cierre entra como "Sin {produto}" en el informe.',
    },
  "Veio do negócio. O que mudar aqui vale para o negócio também.": {
    es: "Viene del negocio. Lo que cambie aquí también vale para el negocio.",
  },
  "Escolha pelo menos um {produto} para confirmar.": { es: "Elija al menos un {produto} para confirmar." },
  "Motivo do ganho (opcional)": { es: "Motivo de la venta (opcional)" },

  // o funil
  'como este funil chama o que o negócio vende. Em branco, vale o padrão do sistema, "Produto ou serviço". Na implantação, o modelo do segmento já preenche: clínica, Tratamento; loja, Produto; escritório, Serviço. É a palavra do bloco do negócio, da janela de ganho e do relatório.':
    {
      es: 'cómo este embudo llama a lo que vende el negocio. En blanco, vale el predeterminado del sistema, "Producto o servicio". En la implementación, el modelo del segmento ya lo completa: clínica, Tratamiento; tienda, Producto; oficina, Servicio. Es la palabra del bloque del negocio, de la ventana de venta y del informe.',
    },
  "O que o negócio vendeu": { es: "Lo que vendió el negocio" },
  "Pedir o {produto} ao marcar como ganho": { es: "Pedir el {produto} al marcar como ganado" },
  "Ligado, a janela Marcar como ganho só confirma com pelo menos um {produto}. Vale para o botão e para o arrasto até a etapa de ganho. Desligado, a janela mostra os {produtos} mas deixa fechar sem.":
    {
      es: "Activado, la ventana Marcar como ganado solo confirma con al menos un {produto}. Vale para el botón y para arrastrar hasta la etapa de venta. Desactivado, la ventana muestra los {produtos} pero deja cerrar sin ellos.",
    },
  "Mostrar valor recorrente": { es: "Mostrar valor recurrente" },
  "Desligado, Valor recorrente (mensal), Duração (meses) e Tipo de receita somem de Editar negócio, de Novo negócio e do cartão deste funil, e o funil conta como avulso nas metas. O que já foi gravado neles continua guardado, e o negócio que tem valor ali mostra um aviso para corrigir.":
    {
      es: "Desactivado, Valor recurrente (mensual), Duración (meses) y Tipo de ingreso desaparecen de Editar negocio, de Nuevo negocio y de la tarjeta de este embudo, y el embudo cuenta como puntual en las metas. Lo ya guardado en ellos sigue guardado, y el negocio que tiene valor allí muestra un aviso para corregir.",
    },
  "Nos funis que já existem as duas nascem como hoje: pedir desligado e valor recorrente ligado. Nada muda até alguém mexer.":
    {
      es: "En los embudos que ya existen las dos nacen como hoy: pedir desactivado y valor recurrente activado. Nada cambia hasta que alguien lo toque.",
    },
  "Com {produtos}, a comanda abre com uma linha por {produto}.": {
    es: "Con {produtos}, la comanda se abre con una línea por {produto}.",
  },

  // o relatório
  "{produtos} vendidos": { es: "{produtos} vendidos" },
  "em {n} negócios · {m} sem {produto}": { es: "en {n} negocios · {m} sin {produto}" },
  "{produtos} vendidos no mês": { es: "{produtos} vendidos en el mes" },
  "negócios de antes, ainda sem {produto} escolhido": { es: "negocios de antes, todavía sin {produto} elegido" },
  "Ajuste do valor digitado à mão": { es: "Ajuste del valor escrito a mano" },
  "{n} negócio fechou por um valor diferente da soma": { es: "{n} negocio cerró por un valor distinto de la suma" },
  "{n} negócios fecharam por um valor diferente da soma": { es: "{n} negocios cerraron por un valor distinto de la suma" },
  "a mensalidade dos negócios, fora da soma dos {produtos}": { es: "la mensualidad de los negocios, fuera de la suma de los {produtos}" },
  "Total, igual à Receita do mês": { es: "Total, igual al Ingreso del mes" },
  "Quantidade soma as unidades: dois itens iguais contam 2. Negócios conta cada negócio fechado uma vez; o negócio com dois {produtos} aparece nos dois. O valor de cada linha é preço × quantidade, menos o desconto.":
    {
      es: "La cantidad suma las unidades: dos ítems iguales cuentan 2. Negocios cuenta cada negocio cerrado una vez; el negocio con dos {produtos} aparece en los dos. El valor de cada línea es precio × cantidad, menos el descuento.",
    },
  "Tempo até fechar por {produto}": { es: "Tiempo hasta cerrar por {produto}" },
  "Mediana": { es: "Mediana" },
  "poucas vendas no mês para tirar conclusão": { es: "pocas ventas en el mes para sacar conclusiones" },
  "Do dia em que o negócio nasceu até o dia em que fechou, a mesma conta do Ciclo de venda. A mediana mostra o caso típico; a média sobe quando um negócio se arrasta. Com menos de 3 vendas no mês, a linha avisa que é pouco para tirar conclusão.":
    {
      es: "Desde el día en que nació el negocio hasta el día en que cerró, la misma cuenta del Ciclo de venta. La mediana muestra el caso típico; el promedio sube cuando un negocio se arrastra. Con menos de 3 ventas en el mes, la línea avisa que es poco para sacar conclusiones.",
    },
  "{n} dia": { es: "{n} día" },

  // as recusas da rota
  "Escolha pelo menos um {produto} para marcar como ganho.": { es: "Elija al menos un {produto} para marcar como ganado." },
  "Confira os itens: quantidade de 1 a 99 e desconto em centavos.": {
    es: "Revise los ítems: cantidad de 1 a 99 y descuento en centavos.",
  },
  "Um item deste negócio mudou enquanto a tela estava aberta. Abra o negócio de novo.": {
    es: "Un ítem de este negocio cambió mientras la pantalla estaba abierta. Abra el negocio de nuevo.",
  },
  "O mesmo produto veio duas vezes. Some na quantidade em vez de repetir a linha.": {
    es: "El mismo producto vino dos veces. Súmelo a la cantidad en lugar de repetir la línea.",
  },
  "Esse produto não está no catálogo desta empresa.": { es: "Ese producto no está en el catálogo de esta empresa." },
  "Esse produto está desativado no catálogo.": { es: "Ese producto está desactivado en el catálogo." },
  "Esse produto está em {moeda_do_produto} e este negócio em {moeda_do_negocio}.": {
    es: "Ese producto está en {moeda_do_produto} y este negocio en {moeda_do_negocio}.",
  },
};
