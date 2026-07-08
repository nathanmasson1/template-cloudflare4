import type { APIRoute } from 'astro';
import { validateSession } from '../../../../../lib/auth';
import {
    addScheduledAIPosts,
    readScheduledAIPosts,
    updateScheduledAIPost,
    type ScheduleInput,
} from '../../../../../plugins/ai-generator/scheduled-posts';

export const prerender = false;

function json(data: any, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function isAuthorized(request: Request) {
    const cookieHeader = request.headers.get('cookie') || '';
    const cookies = Object.fromEntries(
        cookieHeader
            .split(';')
            .map(cookie => {
                const [key, ...value] = cookie.trim().split('=');
                return [key, decodeURIComponent(value.join('='))];
            })
    );
    return validateSession(cookies.admin_session);
}

export const GET: APIRoute = async ({ request }) => {
    if (!await isAuthorized(request)) {
        return json({ success: false, error: 'Nao autorizado' }, 401);
    }

    try {
        const items = await readScheduledAIPosts();
        return json({ success: true, items });
    } catch (error: any) {
        return json({ success: false, error: error.message || 'Erro ao carregar agendamentos.' }, 500);
    }
};

export const POST: APIRoute = async ({ request }) => {
    if (!await isAuthorized(request)) {
        return json({ success: false, error: 'Nao autorizado' }, 401);
    }

    try {
        const body = await request.json();
        const action = body.action || 'add';

        if (action === 'delete' || action === 'retry') {
            if (!body.id) return json({ success: false, error: 'ID obrigatorio.' }, 400);
            return json(await updateScheduledAIPost(String(body.id), action));
        }

        const items = Array.isArray(body.items) ? body.items as ScheduleInput[] : [];
        return json(await addScheduledAIPosts({
            author: String(body.author || ''),
            category: String(body.category || ''),
            items,
        }));
    } catch (error: any) {
        return json({ success: false, error: error.message || 'Erro ao salvar agendamento.' }, 400);
    }
};
