import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { ClerkProvider } from "@clerk/react";
import { Toaster } from "sonner";
import { router } from "./router";
import "./app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" />
    </ClerkProvider>
  </StrictMode>,
);
