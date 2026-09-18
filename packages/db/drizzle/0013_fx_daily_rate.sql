CREATE TABLE "fx_daily_rate" (
	"day" date PRIMARY KEY NOT NULL,
	"usd_mzn" numeric(12, 6) NOT NULL,
	"usd_zar" numeric(12, 6) NOT NULL,
	"source" text NOT NULL,
	"quoted_on" date NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
