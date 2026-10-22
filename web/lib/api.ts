export async function api<T = any>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw Error(body.error ?? "请求失败");
  return body as T;
}

export const post = <T = any>(path: string, body: unknown) =>
  api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
