import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { t } from "i18next";
import {
  Button,
  FormField,
  Form,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  toast,
  FormDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui";
import { AISettingsProviderContext } from "@renderer/context";
import { useContext, useState } from "react";
import { LoaderIcon } from "lucide-react";

const AZURE_REGIONS = [
  "eastus",
  "eastus2",
  "westus",
  "westus2",
  "westus3",
  "centralus",
  "northcentralus",
  "southcentralus",
  "westeurope",
  "northeurope",
  "uksouth",
  "ukwest",
  "francecentral",
  "switzerlandnorth",
  "germanywestcentral",
  "swedencentral",
  "norwayeast",
  "eastasia",
  "southeastasia",
  "japaneast",
  "japanwest",
  "koreacentral",
  "australiaeast",
  "canadacentral",
  "brazilsouth",
  "centralindia",
];

export const AzureSpeechSettings = () => {
  const { azureSpeech, setAzureSpeech } = useContext(
    AISettingsProviderContext
  );
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);

  const azureSpeechSchema = z.object({
    subscriptionKey: z.string().optional(),
    region: z.string().optional(),
  });

  const form = useForm<z.infer<typeof azureSpeechSchema>>({
    resolver: zodResolver(azureSpeechSchema),
    values: {
      subscriptionKey: azureSpeech?.subscriptionKey || "",
      region: azureSpeech?.region || "",
    },
  });

  const onSubmit = async (data: z.infer<typeof azureSpeechSchema>) => {
    setAzureSpeech(data);
    setEditing(false);
    toast.success(t("saved"));
  };

  const testConnection = async () => {
    const key = form.getValues("subscriptionKey");
    const region = form.getValues("region");

    if (!key || !region) {
      toast.error(t("pleaseEnterKeyAndRegion"));
      return;
    }

    setTesting(true);
    try {
      // Use Azure's token issuing endpoint to validate the subscription key
      const tokenUrl = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Length": "0",
        },
      });

      if (response.ok) {
        toast.success(t("connectionTestSuccess"));
      } else if (response.status === 401) {
        toast.error(t("connectionTestFailedInvalidKey"));
      } else if (response.status === 403) {
        toast.error(t("connectionTestFailedForbidden"));
      } else {
        const errorText = await response.text();
        toast.error(
          `${t("connectionTestFailed")}: ${response.status} - ${errorText}`
        );
      }
    } catch (err) {
      toast.error(
        `${t("connectionTestFailed")}: ${err.message}`
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex items-start justify-between py-4">
          <div className="">
            <div className="mb-2">{t("azureSpeechService")}</div>
            <div className="text-sm text-muted-foreground space-y-3">
              <FormDescription>
                {t("azureSpeechSettingsDescription")}
              </FormDescription>
              <FormField
                control={form.control}
                name="subscriptionKey"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">
                        {t("subscriptionKey")}:
                      </FormLabel>
                      <Input
                        disabled={!editing}
                        type="password"
                        placeholder=""
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="region"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">
                        {t("region")}:
                      </FormLabel>
                      <Select
                        disabled={!editing}
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("selectRegion")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {AZURE_REGIONS.map((region) => (
                            <SelectItem key={region} value={region}>
                              {region}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant={editing ? "outline" : "secondary"}
              size="sm"
              type="reset"
              onClick={(event) => {
                event.preventDefault();
                form.reset();
                setEditing(!editing);
              }}
            >
              {editing ? t("cancel") : t("edit")}
            </Button>
            <Button
              className={editing ? "" : "hidden"}
              variant="outline"
              size="sm"
              type="button"
              disabled={testing}
              onClick={(event) => {
                event.preventDefault();
                testConnection();
              }}
            >
              {testing && <LoaderIcon className="mr-1 w-3 h-3 animate-spin" />}
              {t("testConnection")}
            </Button>
            <Button
              className={editing ? "" : "hidden"}
              size="sm"
              type="submit"
            >
              {t("save")}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
};
