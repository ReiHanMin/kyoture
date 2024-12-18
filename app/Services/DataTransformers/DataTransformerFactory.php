<?php

namespace App\Services\DataTransformers;

class DataTransformerFactory
{
    /**
     * Create a data transformer instance based on the site name.
     *
     * @param string $site
     * @return DataTransformerInterface|null
     */
    public static function make(string $site): ?DataTransformerInterface
    {
        return match ($site) {
            'rohm_theatre' => new RohmTheatreDataTransformer(),
            'kyoto_concert_hall' => new KyotoConcertHallDataTransformer(),
            'kyoto_kanze' => new KyotoKanzeDataTransformer(),
            'waondo' => new WaondoDataTransformer(),
            'kyoto_gattaca' => new KyotoGattacaDataTransformer(),
            'kakubarhythm' => new KakubarhythmDataTransformer(),
            'growly'=> new GrowlyDataTransformer(),
            'kyoto_fanj'=> new KyotoFanjDataTransformer(),
            'fabcafe' => new FabCafeDataTransformer(),
            'kyotoartcenter' => new KyotoArtCenterDataTransformer(),
            'kyoto_national_museum' => new KyotoNationalMuseumDataTransformer(),
            // Add other site-specific transformers as you create them
            default => null,
        };
    }
}
