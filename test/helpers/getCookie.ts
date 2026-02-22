
export function getCookie(
  cookies: string[] | undefined,
  name: string
): string | undefined {
  if (!cookies) return undefined

  const cookie = cookies.find(c => c.startsWith(`${name}=`))
  return cookie?.split(";")[0].split("=")[1]
}