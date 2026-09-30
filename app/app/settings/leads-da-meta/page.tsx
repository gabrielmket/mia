/**
 * FORK MIA (.61) — o endereço da antiga Configurações › Formulários da Meta.
 *
 * A tela virou a aba "Formulários de leads" de Configurações › Meta Ads, para a
 * empresa configurar tudo da Meta num lugar só. O endereço fica, redirecionando,
 * porque há link salvo para ele (favoritos, a documentação da .60, mensagens de
 * suporte). O gate de papel e de módulo é o da tela de destino.
 */
import { redirect } from "next/navigation";

export default function LeadsDaMetaPage(): never {
  redirect("/app/settings/meta-ads?aba=formularios");
}
