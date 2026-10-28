import { SquarePen } from "lucide-react";
import { AssistantChat } from "@/components/app/assistant-chat";
import { EmptyPortfolio } from "@/components/app/empty-state";
import { portfolioContextLine } from "@/components/app/portfolio-context";
import { PageHeader } from "@/components/app/stat";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAssistantConfig } from "@/lib/assistant/config";
import {
  getOrCreateActiveConversation,
  loadAllMessages,
} from "@/lib/assistant/conversation-store";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import { redirect } from "next/navigation";
import { startNewConversation } from "./actions";

export default async function AssistantPage() {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");
  const context = await getPortfolioContext(supabase);
  const switcher = portfolioContextLine(context);

  if (!getAssistantConfig()) {
    return (
      <>
        <PageHeader title="Asistente" />
        <Card size="sm">
          <CardContent className="text-sm text-muted-foreground">
            El asistente no está disponible en este momento.
          </CardContent>
        </Card>
      </>
    );
  }
  if (!context.scope) {
    return (
      <>
        <PageHeader title="Asistente" />
        <EmptyPortfolio />
      </>
    );
  }

  const conversation = await getOrCreateActiveConversation(supabase, user.id);
  const messages = await loadAllMessages(supabase, conversation.id);

  return (
    <>
      <PageHeader
        title="Asistente"
        context={switcher}
        actions={
          messages.length > 0 ? (
            <form action={startNewConversation}>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="min-h-11"
              >
                <SquarePen aria-hidden="true" />
                Nueva
              </Button>
            </form>
          ) : null
        }
      />
      <p className="pb-4 text-xs text-muted-foreground">
        Las recomendaciones son opiniones de un modelo de IA y pueden estar
        equivocadas; los números salen de tu cartera. No opera ni cambia nada.
        Usa un modelo gratuito: el proveedor puede guardar las conversaciones.
      </p>
      {/* `key`: una conversación nueva arranca el chat de cero. */}
      <AssistantChat
        key={conversation.id}
        conversationId={conversation.id}
        initialMessages={messages}
      />
    </>
  );
}
