import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
  wrapper?: (props: { children: ReactNode }) => ReactElement;
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { queryClient = createTestQueryClient(), wrapper: ExtraWrapper, ...rest } = options;

  const Wrapper = ({ children }: { children: ReactNode }) => {
    const inner = ExtraWrapper ? <ExtraWrapper>{children}</ExtraWrapper> : children;
    return <QueryClientProvider client={queryClient}>{inner}</QueryClientProvider>;
  };

  return {
    ...render(ui, { wrapper: Wrapper, ...rest }),
    queryClient,
  };
}
