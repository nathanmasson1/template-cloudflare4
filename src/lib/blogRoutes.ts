/** URL de um post individual: "/{slug}" */
export function postUrl(slug: string): string {
    return `/${slug}`;
}

/** URL da listagem de posts: "/blog" */
export function blogIndexUrl(): string {
    return '/blog';
}
