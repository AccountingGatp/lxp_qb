"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const API_BASE_URL =
// "https://lxp-qb-api.vercel.app"

  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

export default function Home() {
  const [authStatus, setAuthStatus] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isConnected = Boolean(authStatus?.connected);

  const loadAuthStatus = useCallback(async () => {
    setAuthLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/status`);
      const data = await response.json();
      setAuthStatus(data);
      return data;
    } catch (_err) {
      const fallback = {
        connected: false,
        error: "Backend not reachable.",
      };
      setAuthStatus(fallback);
      return fallback;
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectedParam = params.get("connected");
    const oauthError = params.get("error");

    async function init() {
      const status = await loadAuthStatus();

      if (connectedParam === "1") {
        setInfo(
          status?.connected
            ? "QuickBooks connected successfully. You can upload your XLSX file now."
            : "OAuth finished, but QuickBooks is still not connected. Try Connect again."
        );
        window.history.replaceState({}, "", "/");
      } else if (connectedParam === "0") {
        setError(oauthError || "QuickBooks connection failed.");
        window.history.replaceState({}, "", "/");
      }
    }

    init();
  }, [loadAuthStatus]);

  const warnings = useMemo(() => result?.parsed?.warnings || [], [result]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!isConnected) {
      setError("Connect QuickBooks before uploading a file.");
      return;
    }

    if (!file) {
      setError("Choose an XLSX file first.");
      return;
    }

    setError("");
    setInfo("");
    setResult(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/uploads/xlsx`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        const message = data.errors?.length
          ? `${data.error}\n${data.errors.map((item) => `- ${item}`).join("\n")}`
          : data.error || "Upload failed.";
        if (data.reconnectUrl) {
          throw new Error(`${message} Reconnect at ${data.reconnectUrl}`);
        }
        throw new Error(message);
      }

      setResult(data);
    } catch (uploadError) {
      setError(uploadError.message || "Upload failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="space-y-2">
          <Badge variant="outline">QuickBooks Sandbox</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            XLSX Upload To QBO
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Connect QuickBooks first, then upload one spreadsheet to create
            missing inventory and a vendor bill.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>1. Connect QuickBooks</CardTitle>
              <CardDescription>
                Authorization is required before file upload is enabled.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span>Status:</span>
                <Badge variant={isConnected ? "default" : "outline"}>
                  {authLoading
                    ? "Checking..."
                    : isConnected
                      ? "Connected"
                      : "Not Connected"}
                </Badge>
              </div>
              {authStatus?.realmId ? (
                <p className="text-muted-foreground">
                  Realm ID: <code>{authStatus.realmId}</code>
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={authLoading}
                  onClick={() => {
                    window.location.href = `${API_BASE_URL}/auth/connect`;
                  }}
                >
                  {isConnected ? "Reconnect QuickBooks" : "Connect QuickBooks"}
                </Button>
                <Button
                  disabled={authLoading}
                  onClick={loadAuthStatus}
                  variant="outline"
                >
                  Refresh Status
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className={!isConnected ? "opacity-60" : undefined}>
            <CardHeader>
              <CardTitle>2. Upload Spreadsheet</CardTitle>
              <CardDescription>
                {isConnected
                  ? "Upload is enabled. The first worksheet will be synced to QuickBooks."
                  : "Connect QuickBooks first to unlock upload."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <Input
                  accept=".xlsx,.xls"
                  disabled={!isConnected || isSubmitting}
                  onChange={(event) =>
                    setFile(event.target.files?.[0] || null)
                  }
                  type="file"
                />
                <Button
                  disabled={!isConnected || isSubmitting || !file}
                  type="submit"
                >
                  {isSubmitting ? "Uploading..." : "Upload And Sync"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {info ? (
          <Alert>
            <AlertTitle>Connected</AlertTitle>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Upload failed</AlertTitle>
            <AlertDescription>
              <pre className="whitespace-pre-wrap font-sans text-sm">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : null}

        {warnings.length ? (
          <Alert>
            <AlertTitle>Warnings</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <>
            <div className="grid gap-6 md:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Vendor</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>{result.sync.vendor.name || "-"}</p>
                  <p className="text-muted-foreground">
                    {result.sync.vendor.created
                      ? "Created in QuickBooks"
                      : "Reused existing vendor"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Bill</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>ID: {result.sync.bill.id}</p>
                  <p>Doc #: {result.sync.bill.docNumber || "-"}</p>
                  <p>Total: {formatCurrency(result.sync.bill.totalAmt)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Inventory Sync</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>Created: {result.sync.createdItems.length}</p>
                  <p>Reused: {result.sync.reusedItems.length}</p>
                  <p>
                    SKU updated:{" "}
                    {
                      (result.sync.reusedItems || []).filter(
                        (item) => item.skuUpdated
                      ).length
                    }
                  </p>
                  <p>Rows: {result.sync.payloadSummary.totalRows}</p>
                  <p>
                    Tax:{" "}
                    {result.sync.tax?.mode === "non_taxable"
                      ? "Non-taxable (Taxable=false)"
                      : "Non-taxable"}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Parsed Rows</CardTitle>
                <CardDescription>
                  Worksheet: {result.parsed.sheetName} | Date:{" "}
                  {result.parsed.header.date || "-"} | Ref:{" "}
                  {result.parsed.header.ref || "-"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Product Name</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit Cost</TableHead>
                      <TableHead>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.parsed.rows.map((row) => (
                      <TableRow key={`${row.rowNumber}-${row.sku}`}>
                        <TableCell>{row.sku}</TableCell>
                        <TableCell>{row.productName || "-"}</TableCell>
                        <TableCell>{row.quantity}</TableCell>
                        <TableCell>{formatCurrency(row.cost)}</TableCell>
                        <TableCell>{formatCurrency(row.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </main>
  );
}
