const NOTION_VERSION = "2025-09-03";

const DATABASE_ID = "37b1add7ed818015bb8ec178e2cd6f92";
const DATE_PROPERTY = "Date";
const CHECKIN_PROPERTY = "Daily Check In";

function sendJson(response, status, body) {
  response.status(status).json(body);
}

async function notionRequest(path, options = {}) {
  const token = process.env.NOTION_TOKEN;

  if (!token) {
    throw new Error("NOTION_TOKEN is not configured.");
  }

  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Notion error:", data);
    throw new Error(data.message || "Notion API request failed.");
  }

  return data;
}

async function getDataSourceId() {
  const database = await notionRequest(`/databases/${DATABASE_ID}`, {
    method: "GET"
  });

  const dataSource = database.data_sources?.[0];

  if (!dataSource?.id) {
    throw new Error("No data source was found inside the database.");
  }

  return dataSource.id;
}

async function findPageByDate(date) {
  const dataSourceId = await getDataSourceId();

  const result = await notionRequest(
    `/data_sources/${dataSourceId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: DATE_PROPERTY,
          date: {
            equals: date
          }
        },
        page_size: 1
      })
    }
  );

  return result.results?.[0] || null;
}

function readRichText(page) {
  const property = page?.properties?.[CHECKIN_PROPERTY];

  if (!property) {
    return "";
  }

  const pieces = property.rich_text || [];

  return pieces
    .map(piece => piece.plain_text || piece.text?.content || "")
    .join("");
}

async function updateCheckIn(pageId, text) {
  return notionRequest(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [CHECKIN_PROPERTY]: {
          rich_text: text
            ? [
                {
                  type: "text",
                  text: {
                    content: text
                  }
                }
              ]
            : []
        }
      }
    })
  });
}

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }

  try {
    const date =
      request.method === "GET"
        ? request.query.date
        : request.body?.date;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return sendJson(response, 400, {
        error: "A date in YYYY-MM-DD format is required."
      });
    }

    const page = await findPageByDate(date);

    if (!page) {
      return sendJson(response, 404, {
        error: "No habit-tracker row exists for this date."
      });
    }

    if (request.method === "GET") {
      return sendJson(response, 200, {
        pageId: page.id,
        text: readRichText(page)
      });
    }

    if (request.method === "POST") {
      const text =
        typeof request.body?.text === "string"
          ? request.body.text.trim()
          : "";

      await updateCheckIn(page.id, text);

      return sendJson(response, 200, {
        success: true,
        pageId: page.id
      });
    }

    return sendJson(response, 405, {
      error: "Method not allowed."
    });
  } catch (error) {
    console.error(error);

    return sendJson(response, 500, {
      error: error.message || "Unexpected server error."
    });
  }
}
